import { NextRequest, NextResponse } from "next/server";
import {
  addExpense,
  authorRule,
  logActivity,
  convertTo,
  deleteExpense,
  getTrip,
  updateExpense,
} from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";
import { notify, othersInTrip } from "@/lib/push";
import { deleteReceipt } from "@/lib/receipts";
import { CATEGORIES } from "@/lib/types";
import type { Trip } from "@/lib/types";
import { logError } from "@/lib/errors";

/**
 * Expense endpoints.
 *
 * Each write goes through a single atomic operation in the data layer. The previous
 * implementation loaded the whole trip, pushed to an array and wrote everything back,
 * which lost expenses whenever two people added one at the same time.
 */

/** Checks the caller may write, then loads the trip, or returns the response to send. */
async function loadTrip(id: string): Promise<
  | {
      trip: Trip;
      caller: { id?: string; isOwner: boolean };
      user: { id: string; name: string } | null;
    }
  | { error: NextResponse }
> {
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return { error: auth.response };

  const trip = await getTrip(id);
  if (!trip) {
    return { error: NextResponse.json({ error: "Trip not found" }, { status: 404 }) };
  }
  return {
    trip,
    caller: { id: auth.user?.id, isOwner: auth.level === "owner" },
    user: auth.user,
  };
}

/**
 * Turns "may this caller change that row?" into the answer to send back.
 *
 * Anyone in a trip can add an expense, and each answers for the ones they added; the
 * owner can change any of them. A row belonging to another trip reads as one that does
 * not exist, because authorisation is per trip and the id arrives in the request body.
 */
function refuseRow(check: ReturnType<typeof authorRule>, noun: string): NextResponse | null {
  if (check === "ok") return null;
  if (check === "missing") {
    return NextResponse.json({ error: `${noun} not found` }, { status: 404 });
  }
  return NextResponse.json(
    { error: `Only whoever added it, or the trip owner, can change that` },
    { status: 403 }
  );
}

function validateAmount(raw: unknown): number | null {
  const parsed = parseFloat(String(raw));
  if (!isFinite(parsed) || parsed <= 0 || parsed > 1e9) return null;
  return parsed;
}

/**
 * A date, or null if it is not one.
 *
 * `new Date("nonsense").getTime()` is NaN, and NaN reached the insert as a null and came
 * back out as a 500 with a constraint violation in it — a request the client got wrong,
 * reported as the server breaking. Found by the error log on its first day.
 */
function validateDate(raw: unknown): number | null {
  const parsed = new Date(raw as string).getTime();
  return isFinite(parsed) ? parsed : null;
}

/** Checks the split members exist and that any weights refer to them. */
function validateSplit(
  trip: Trip,
  splitIds: string[],
  splitShares: unknown
): NextResponse | null {
  for (const sid of splitIds) {
    if (!trip.members.find((m) => m.id === sid)) {
      return NextResponse.json({ error: `Invalid split member: ${sid}` }, { status: 400 });
    }
  }
  if (splitShares && typeof splitShares === "object") {
    for (const [key, val] of Object.entries(splitShares as Record<string, unknown>)) {
      if (!splitIds.includes(key)) {
        return NextResponse.json(
          { error: `splitShares key "${key}" not in splitAmong` },
          { status: 400 }
        );
      }
      if (typeof val !== "number" || val <= 0 || !isFinite(val)) {
        return NextResponse.json(
          { error: `splitShares["${key}"] must be a positive finite number` },
          { status: 400 }
        );
      }
    }
  }
  return null;
}

// POST — add a new expense
export async function POST(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/expense">) {
  const { id } = await ctx.params;
  const loaded = await loadTrip(id);
  if ("error" in loaded) return loaded.error;
  const { trip, caller, user } = loaded;

  try {
    const body = await request.json();
    const { description, amount, currency, paidBy, splitAmong, category } = body;

    if (!description || !amount || !paidBy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const parsedAmount = validateAmount(amount);
    if (parsedAmount === null) {
      return NextResponse.json(
        { error: "Amount must be a positive finite number up to 1 billion" },
        { status: 400 }
      );
    }

    if (!trip.members.find((m) => m.id === paidBy)) {
      return NextResponse.json({ error: "Invalid paidBy member" }, { status: 400 });
    }

    const parsedDate = body.date === undefined ? null : validateDate(body.date);
    if (body.date !== undefined && parsedDate === null) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const splitIds: string[] = splitAmong || trip.members.map((m) => m.id);
    const invalid = validateSplit(trip, splitIds, body.splitShares);
    if (invalid) return invalid;

    const expCurrency = currency || trip.currency;
    let amountBase: number;
    let rateUsed: boolean;
    try {
      // Into the trip's currency, which is the unit every balance is kept and shown in.
      // When the expense is already in it — the usual case — no rate is consulted at all,
      // so a trip run entirely in pesos never depends on the network.
      ({ amount: amountBase, rateUsed } = await convertTo(parsedAmount, expCurrency, trip.currency));
    } catch (err) {
      // Refusing beats guessing: a made-up 1:1 rate would corrupt every balance.
      return NextResponse.json(
        {
          error: `Cannot convert ${expCurrency} to ${trip.currency}: ${
            err instanceof Error ? err.message : "Rate unavailable"
          }`,
        },
        { status: 502 }
      );
    }

    const expense = await addExpense(id, {
      description: String(description).trim(),
      amount: parsedAmount,
      currency: expCurrency,
      amountBase,
      paidBy,
      splitAmong: splitIds,
      splitShares:
        body.splitShares && Object.keys(body.splitShares).length > 0 ? body.splitShares : undefined,
      category: CATEGORIES.find((c) => c.id === category) ? category : "other",
      date: parsedDate ?? Date.now(),
      exchangeRate:
        expCurrency !== trip.currency && amountBase > 0 ? parsedAmount / amountBase : undefined,
      rateAvailable: rateUsed,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : undefined,
      // Filename returned by the receipt upload; validated on read, so a made-up value
      // simply resolves to no photo.
      receipt:
        typeof body.receipt === "string" && /^[0-9a-f]{8,40}\.(jpe?g|png|webp)$/i.test(body.receipt)
          ? body.receipt
          : undefined,
      // Supplied by queued offline writes so a retry cannot duplicate the expense.
      clientId: typeof body.clientId === "string" ? body.clientId.slice(0, 64) : undefined,
      // Recorded so the person who typed it can fix it, and so nobody else can.
      createdBy: caller.id,
    });

    if (!expense) {
      return NextResponse.json({ error: "Failed to add expense" }, { status: 500 });
    }
    logActivity(id, user, "expenseAdded", expense.description);
    // Everyone else in the trip. Fire and forget: the expense is already saved, and a
    // push service on the other side of the internet must not be able to undo that.
    notify(othersInTrip(id, user?.id), {
      action: "expense",
      trip: trip.name,
      actor: user?.name ?? "?",
      subject: expense.description,
      url: `/trip/${id}`,
    });
    return NextResponse.json(expense);
  } catch (error) {
    logError("POST /api/trips/[id]/expense", error);
    return NextResponse.json({ error: "Failed to add expense" }, { status: 500 });
  }
}

// PATCH — edit an existing expense
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/expense">) {
  const { id } = await ctx.params;
  const loaded = await loadTrip(id);
  if ("error" in loaded) return loaded.error;
  const { trip, caller, user } = loaded;

  try {
    const body = await request.json();
    const { expenseId, description, amount, currency, paidBy, splitAmong, category } = body;

    if (!expenseId) {
      return NextResponse.json({ error: "expenseId required" }, { status: 400 });
    }

    const refusal = refuseRow(authorRule("expense", expenseId, id, caller), "Expense");
    if (refusal) return refusal;

    const existing = trip.expenses.find((e) => e.id === expenseId);
    if (!existing) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const newPaidBy = paidBy || existing.paidBy;
    if (!trip.members.find((m) => m.id === newPaidBy)) {
      return NextResponse.json({ error: "Invalid paidBy member" }, { status: 400 });
    }

    const parsedDate = body.date === undefined ? null : validateDate(body.date);
    if (body.date !== undefined && parsedDate === null) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const newSplitAmong: string[] = splitAmong || existing.splitAmong;
    const invalid = validateSplit(trip, newSplitAmong, body.splitShares);
    if (invalid) return invalid;

    const newCurrency = currency || existing.currency;
    let newAmount = existing.amount;
    if (amount !== undefined) {
      const parsed = validateAmount(amount);
      if (parsed === null) {
        return NextResponse.json(
          { error: "Amount must be a positive finite number up to 1 billion" },
          { status: 400 }
        );
      }
      newAmount = parsed;
    }

    let newAmountBase = existing.amountBase;
    let rateUsed = true;
    const amountChanged = newAmount !== existing.amount || currency !== undefined;
    if (amountChanged) {
      try {
        const result = await convertTo(newAmount, newCurrency, trip.currency);
        newAmountBase = result.amount;
        rateUsed = result.rateUsed;
      } catch (err) {
        return NextResponse.json(
          {
            error: `Cannot convert ${newCurrency} to ${trip.currency}: ${
              err instanceof Error ? err.message : "Rate unavailable"
            }`,
          },
          { status: 502 }
        );
      }
    }

    const updated = await updateExpense(id, expenseId, {
      description: description?.trim() || existing.description,
      amount: newAmount,
      currency: newCurrency,
      amountBase: newAmountBase,
      paidBy: newPaidBy,
      splitAmong: newSplitAmong,
      splitShares:
        body.splitShares !== undefined
          ? Object.keys(body.splitShares).length > 0
            ? body.splitShares
            : undefined
          : existing.splitShares,
      category:
        category && CATEGORIES.find((c) => c.id === category) ? category : existing.category,
      date: parsedDate ?? existing.date,
      exchangeRate:
        newCurrency !== trip.currency && newAmountBase > 0 ? newAmount / newAmountBase : undefined,
      rateAvailable: rateUsed,
    });

    if (!updated) {
      return NextResponse.json({ error: "Failed to edit expense" }, { status: 500 });
    }
    logActivity(id, user, "expenseEdited", updated.description);
    return NextResponse.json(updated);
  } catch (error) {
    logError("PATCH /api/trips/[id]/expense", error);
    return NextResponse.json({ error: "Failed to edit expense" }, { status: 500 });
  }
}

// DELETE — remove an expense
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/expense">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;

  let expenseId: string;
  try {
    ({ expenseId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!expenseId) {
    return NextResponse.json({ error: "expenseId required" }, { status: 400 });
  }

  const refusal = refuseRow(
    authorRule("expense", expenseId, id, {
      id: auth.user?.id,
      isOwner: auth.level === "owner",
    }),
    "Expense"
  );
  if (refusal) return refusal;

  // Looked up first: once the row is gone there is nothing left pointing at the file,
  // and it would sit on disk until the nightly sweep noticed it.
  const trip = await getTrip(id);
  const gone = trip?.expenses.find((e) => e.id === expenseId);

  const removed = await deleteExpense(id, expenseId);
  if (!removed) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }

  logActivity(id, auth.user, "expenseDeleted", gone?.description);
  if (gone?.receipt) await deleteReceipt(id, gone.receipt);

  return NextResponse.json({ success: true });
}
