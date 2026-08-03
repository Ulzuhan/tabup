import { NextRequest, NextResponse } from "next/server";
import { addPayment, deletePayment, getTrip } from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";

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
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      return NextResponse.json({ error: "Cannot settle with yourself" }, { status: 400 });
    }

    const parsedAmount = parseFloat(String(amount));
    if (!isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1e9) {
      return NextResponse.json(
        { error: "Amount must be a positive finite number up to 1 billion" },
        { status: 400 }
      );
    }

    const payment = await addPayment(id, {
      from,
      to,
      amount: Math.round(parsedAmount * 100) / 100,
      date: body.date ? new Date(body.date).getTime() : Date.now(),
      note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : undefined,
      clientId: typeof body.clientId === "string" ? body.clientId.slice(0, 64) : undefined,
    });

    if (!payment) {
      return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
    }
    return NextResponse.json(payment);
  } catch (error) {
    console.error("Add payment error:", error);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
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

  const removed = await deletePayment(id, paymentId);
  if (!removed) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
