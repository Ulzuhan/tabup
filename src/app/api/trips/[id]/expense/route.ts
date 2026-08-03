import { NextRequest, NextResponse } from "next/server";
import {
  addExpense,
  convertToEur,
  deleteExpense,
  getTrip,
  updateExpense,
} from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";
import { CATEGORIES } from "@/lib/types";
import type { Trip } from "@/lib/types";

/**
 * Expense endpoints.
 *
 * Each write goes through a single atomic operation in the data layer. The previous
 * implementation loaded the whole trip, pushed to an array and wrote everything back,
 * which lost expenses whenever two people added one at the same time.
 */

/** Checks the caller may write, then loads the trip, or returns the response to send. */
async function loadTrip(id: string): Promise<{ trip: Trip } | { error: NextResponse }> {
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return { error: auth.response };

  const trip = await getTrip(id);
  if (!trip) {
    return { error: NextResponse.json({ error: "Trip not found" }, { status: 404 }) };
  }
  return { trip };
}

function validateAmount(raw: unknown): number | null {
  const parsed = parseFloat(String(raw));
  if (!isFinite(parsed) || parsed <= 0 || parsed > 1e9) return null;
  return parsed;
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
  const { trip } = loaded;

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

    const splitIds: string[] = splitAmong || trip.members.map((m) => m.id);
    const invalid = validateSplit(trip, splitIds, body.splitShares);
    if (invalid) return invalid;

    const expCurrency = currency || trip.currency;
    let amountEur: number;
    let rateUsed: boolean;
    try {
      ({ amountEur, rateUsed } = await convertToEur(parsedAmount, expCurrency).then((r) => ({
        amountEur: r.amountEur,
        rateUsed: r.rateUsed,
      })));
    } catch (err) {
      // Refusing beats guessing: a made-up 1:1 rate would corrupt every balance.
      return NextResponse.json(
        {
          error: `Cannot convert ${expCurrency} to EUR: ${
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
      amountEur,
      paidBy,
      splitAmong: splitIds,
      splitShares:
        body.splitShares && Object.keys(body.splitShares).length > 0 ? body.splitShares : undefined,
      category: CATEGORIES.find((c) => c.id === category) ? category : "other",
      date: body.date ? new Date(body.date).getTime() : Date.now(),
      exchangeRate: expCurrency !== "EUR" && amountEur > 0 ? parsedAmount / amountEur : undefined,
      rateAvailable: rateUsed,
      // Supplied by queued offline writes so a retry cannot duplicate the expense.
      clientId: typeof body.clientId === "string" ? body.clientId.slice(0, 64) : undefined,
    });

    if (!expense) {
      return NextResponse.json({ error: "Failed to add expense" }, { status: 500 });
    }
    return NextResponse.json(expense);
  } catch (error) {
    console.error("Add expense error:", error);
    return NextResponse.json({ error: "Failed to add expense" }, { status: 500 });
  }
}

// PATCH — edit an existing expense
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/expense">) {
  const { id } = await ctx.params;
  const loaded = await loadTrip(id);
  if ("error" in loaded) return loaded.error;
  const { trip } = loaded;

  try {
    const body = await request.json();
    const { expenseId, description, amount, currency, paidBy, splitAmong, category } = body;

    if (!expenseId) {
      return NextResponse.json({ error: "expenseId required" }, { status: 400 });
    }

    const existing = trip.expenses.find((e) => e.id === expenseId);
    if (!existing) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const newPaidBy = paidBy || existing.paidBy;
    if (!trip.members.find((m) => m.id === newPaidBy)) {
      return NextResponse.json({ error: "Invalid paidBy member" }, { status: 400 });
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

    let newAmountEur = existing.amountEur;
    let rateUsed = true;
    const amountChanged = newAmount !== existing.amount || currency !== undefined;
    if (amountChanged) {
      try {
        const result = await convertToEur(newAmount, newCurrency);
        newAmountEur = result.amountEur;
        rateUsed = result.rateUsed;
      } catch (err) {
        return NextResponse.json(
          {
            error: `Cannot convert ${newCurrency} to EUR: ${
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
      amountEur: newAmountEur,
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
      date: body.date ? new Date(body.date).getTime() : existing.date,
      exchangeRate: newCurrency !== "EUR" && newAmountEur > 0 ? newAmount / newAmountEur : undefined,
      rateAvailable: rateUsed,
    });

    if (!updated) {
      return NextResponse.json({ error: "Failed to edit expense" }, { status: 500 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Edit expense error:", error);
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

  const removed = await deleteExpense(id, expenseId);
  if (!removed) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
