import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import {
  addPayment,
  authorRule,
  convertTo,
  deletePayment,
  getTrip,
  logActivity,
} from "@/lib/store";
import { CURRENCIES } from "@/lib/types";
import { authorizeTrip } from "@/lib/authorize";
import { notify, othersInTrip } from "@/lib/push";
import { logError } from "@/lib/errors";

/**
 * Settle-up payments: one member transferring money to another.
 *
 * Amounts are in the trip's own currency, unlike expenses which are normalised, so
 * no exchange rate is involved here.
 */

// POST — record a payment
export async function POST(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/payment">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;

  const trip = await getTrip(id);
  if (!trip) {
    return fail("not_found", 404);
  }

  try {
    const body = await request.json();
    const { from, to, amount, note } = body;

    if (!from || !to || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: from, to, amount" },
        { status: 400 }
      );
    }
    if (!trip.members.find((m) => m.id === from)) {
      return NextResponse.json({ error: "Invalid 'from' member" }, { status: 400 });
    }
    if (!trip.members.find((m) => m.id === to)) {
      return NextResponse.json({ error: "Invalid 'to' member" }, { status: 400 });
    }
    if (from === to) {
      return fail("settle_self", 400);
    }

    const parsedDate = body.date === undefined ? Date.now() : new Date(body.date).getTime();
    if (!isFinite(parsedDate)) {
      return fail("invalid_date", 400);
    }

    const parsedAmount = parseFloat(String(amount));
    if (!isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1e9) {
      return fail("amount_range", 400);
    }

    /**
     * A settle-up can be handed over in any currency.
     *
     * It used to be assumed to be the trip's, which is wrong the moment somebody clears
     * a peso debt with a euro transfer — the commonest way a trip actually ends. Same
     * rules as an expense: converted as of the day it happened, and refused rather than
     * guessed if there is no rate at all.
     */
    const payCurrency =
      typeof body.currency === "string" && CURRENCIES.find((c) => c.code === body.currency)
        ? body.currency
        : trip.currency;

    const rounded = Math.round(parsedAmount * 100) / 100;
    let amountBase = rounded;
    let rateUsed = true;
    try {
      ({ amount: amountBase, rateUsed } = await convertTo(
        rounded,
        payCurrency,
        trip.currency,
        parsedDate
      ));
    } catch {
      return fail("rate_unavailable", 502, { from: payCurrency, to: trip.currency });
    }

    const payment = await addPayment(id, {
      from,
      to,
      amount: rounded,
      currency: payCurrency,
      amountBase,
      rateAvailable: rateUsed,
      date: parsedDate,
      note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : undefined,
      clientId: typeof body.clientId === "string" ? body.clientId.slice(0, 64) : undefined,
      // Recorded so whoever entered it can undo it, and so nobody else can.
      createdBy: auth.user?.id,
    });

    if (!payment) {
      return fail("save_failed", 500);
    }
    const name = (memberId: string) => trip.members.find((m) => m.id === memberId)?.name ?? "?";
    const between = `${name(payment.from)} → ${name(payment.to)}`;
    logActivity(id, auth.user, "paymentAdded", between);
    notify(othersInTrip(id, auth.user?.id), {
      action: "payment",
      trip: trip.name,
      actor: auth.user?.name ?? "?",
      subject: between,
      url: `/trip/${id}`,
    });
    return NextResponse.json(payment);
  } catch (error) {
    logError("POST /api/trips/[id]/payment", error);
    return fail("save_failed", 500);
  }
}

// DELETE — undo a payment
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/payment">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;

  let paymentId: string;
  try {
    ({ paymentId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!paymentId) {
    return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  }

  // Same rule as an expense: yours to undo, or the owner's. A payment id from another
  // trip has to read as one that does not exist.
  const check = authorRule("payment", paymentId, id, {
    id: auth.user?.id,
    isOwner: auth.level === "owner",
  });
  if (check === "missing") {
    return fail("not_found", 404);
  }
  if (check === "forbidden") {
    return fail("author_only", 403);
  }

  const trip = await getTrip(id);
  const gone = trip?.payments.find((p) => p.id === paymentId);

  const removed = await deletePayment(id, paymentId);
  if (!removed) {
    return fail("not_found", 404);
  }

  const name = (memberId?: string) => trip?.members.find((m) => m.id === memberId)?.name ?? "?";
  logActivity(id, auth.user, "paymentDeleted", `${name(gone?.from)} → ${name(gone?.to)}`);
  return NextResponse.json({ success: true });
}
