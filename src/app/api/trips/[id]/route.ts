import { NextRequest, NextResponse } from "next/server";
import { getTrip, updateTrip, deleteTrip, calculateBalances, calculateSettlements, generateId } from "@/lib/store";
import { EMOJIS } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const balances = calculateBalances(trip);
  const settlements = calculateSettlements(trip);

  // Enrich with member names
  const enrichedBalances = balances.map((b) => {
    const member = trip.members.find((m) => m.id === b.memberId);
    return { ...b, name: member?.name, emoji: member?.emoji };
  });

  const enrichedSettlements = settlements.map((s) => {
    const fromMember = trip.members.find((m) => m.id === s.from);
    const toMember = trip.members.find((m) => m.id === s.to);
    return {
      ...s,
      fromName: fromMember?.name,
      fromEmoji: fromMember?.emoji,
      toName: toMember?.name,
      toEmoji: toMember?.emoji,
    };
  });

  const totalExpenses = trip.expenses.reduce((sum, e) => sum + e.amountEur, 0);

  return NextResponse.json({
    ...trip,
    balances: enrichedBalances,
    settlements: enrichedSettlements,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  const deleted = await deleteTrip(id);
  if (!deleted) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

    // Add members
    if (body.addMembers && Array.isArray(body.addMembers)) {
      const names = body.addMembers.filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0 && n.trim().length <= 50);
      if (names.length === 0) {
        return NextResponse.json({ error: "addMembers must contain non-empty strings" }, { status: 400 });
      }
      const existingNames = trip.members.map((m) => m.name.toLowerCase());
      const duplicates = names.filter((n: string) => existingNames.includes(n.trim().toLowerCase()));
      if (duplicates.length > 0) {
        return NextResponse.json({ error: `Duplicate member name(s): ${duplicates.join(", ")}` }, { status: 400 });
      }
      const newMembers = names.map((name: string, i: number) => ({
        id: generateId(),
        name: name.trim(),
        emoji: EMOJIS[(trip.members.length + i) % EMOJIS.length],
      }));
      trip.members.push(...newMembers);
      trip.version = (trip.version || 0) + 1;
      await updateTrip(trip);
    }

    // Rename trip
    if (body.name && typeof body.name === "string" && body.name.trim().length > 0) {
      trip.name = body.name.trim();
      trip.version = (trip.version || 0) + 1;
      await updateTrip(trip);
    }

    // Remove members (cascade: remove their expenses and payments)
    if (body.removeMembers && Array.isArray(body.removeMembers)) {
      const removeIds = new Set(body.removeMembers as string[]);
      trip.members = trip.members.filter((m) => !removeIds.has(m.id));
      trip.expenses = trip.expenses.filter((e) => !removeIds.has(e.paidBy));
      trip.payments = (trip.payments || []).filter((p) => !removeIds.has(p.from) && !removeIds.has(p.to));
      trip.version = (trip.version || 0) + 1;
      await updateTrip(trip);
    }

    return NextResponse.json({ members: trip.members });
  } catch (error) {
    console.error("Update trip error:", error);
    return NextResponse.json({ error: "Failed to update trip" }, { status: 500 });
  }
}