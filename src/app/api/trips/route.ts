import { NextRequest, NextResponse } from "next/server";
import { createTrip, generateId } from "@/lib/store";
import type { Trip } from "@/lib/types";
import { CURRENCIES, EMOJIS } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, currency = "EUR", members } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Trip name is required" }, { status: 400 });
    }

    if (!members || !Array.isArray(members) || members.length < 2) {
      return NextResponse.json({ error: "At least 2 members required" }, { status: 400 });
    }
    for (const m of members) {
      if (typeof m.name !== "string" || m.name.trim().length === 0 || m.name.trim().length > 50) {
        return NextResponse.json({ error: "Each member name must be 1-50 characters" }, { status: 400 });
      }
    }
    const memberNames = members.map((m: { name: string }) => m.name.trim().toLowerCase());
    if (new Set(memberNames).size !== memberNames.length) {
      return NextResponse.json({ error: "Duplicate member names are not allowed" }, { status: 400 });
    }

    if (!CURRENCIES.find((c) => c.code === currency)) {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }

    const trip: Trip = {
      id: generateId(),
      name: name.trim(),
      currency,
      createdAt: Date.now(),
      version: 1,
      members: members.map((m: { name: string }, i: number) => ({
        id: generateId(),
        name: m.name.trim(),
        emoji: EMOJIS[i % EMOJIS.length],
      })),
      expenses: [],
      payments: [],
    };

    await createTrip(trip);

    return NextResponse.json({
      id: trip.id,
      name: trip.name,
      members: trip.members,
      createdAt: trip.createdAt,
    });
  } catch (error) {
    console.error("Create trip error:", error);
    return NextResponse.json({ error: "Failed to create trip" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { listTrips } = await import("@/lib/store");
    const trips = await listTrips();
    const summary = trips.map((t) => ({
      id: t.id,
      name: t.name,
      currency: t.currency,
      memberCount: t.members.length,
      expenseCount: t.expenses.length,
      createdAt: t.createdAt,
    }));
    return NextResponse.json({ trips: summary });
  } catch (error) {
    console.error("List trips error:", error);
    return NextResponse.json({ error: "Failed to list trips" }, { status: 500 });
  }
}