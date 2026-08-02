import { NextRequest, NextResponse } from "next/server";
import { getTrip, updateTrip, generateId } from "@/lib/store";
import type { Payment } from "@/lib/types";

// POST — Record a settle-up payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  let trip;
  try {
    trip = await getTrip(id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Invalid trip ID format") || msg.includes("Path traversal")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load trip" }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { from, to, amount, note } = body;

    if (!from || !to || !amount) {
      return NextResponse.json({ error: "Missing required fields: from, to, amount" }, { status: 400 });
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

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1e9) {
      return NextResponse.json({ error: "Amount must be a positive finite number up to 1 billion" }, { status: 400 });
    }

    const payment: Payment = {
      id: generateId(),
      from,
      to,
      amount: Math.round(parsedAmount * 100) / 100,
      date: body.date ? new Date(body.date).getTime() : Date.now(),
      note: note?.trim() || undefined,
    };

    if (!trip.payments) trip.payments = [];
    trip.payments.push(payment);
    trip.version = (trip.version || 0) + 1;
    await updateTrip(trip);

    return NextResponse.json(payment);
  } catch (error) {
    console.error("Add payment error:", error);
    return NextResponse.json({ error: "Failed to add payment" }, { status: 500 });
  }
}

// DELETE — Remove a settle-up payment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  let trip;
  try {
    trip = await getTrip(id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Invalid trip ID format") || msg.includes("Path traversal")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load trip" }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  let paymentId: string;
  try {
    ({ paymentId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!paymentId) {
    return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  }

  const idx = (trip.payments || []).findIndex((p) => p.id === paymentId);
  if (idx === -1) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  trip.payments.splice(idx, 1);
  trip.version = (trip.version || 0) + 1;
  await updateTrip(trip);

  return NextResponse.json({ success: true });
}