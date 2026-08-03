import { NextRequest, NextResponse } from "next/server";
import { atTripLimit, createTrip, FREE_TRIP_LIMIT, listTrips } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import { CURRENCIES, EMOJIS } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    // Signing in is optional. Without an account the trip has no owner and lives on
    // its link, which is what keeps the first use free of a registration wall.
    const user = await getCurrentUser();
    if (user && atTripLimit(user)) {
      return NextResponse.json(
        {
          error: `The free plan covers ${FREE_TRIP_LIMIT} trips. Upgrade to create more.`,
          code: "trip_limit",
        },
        { status: 402 }
      );
    }

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

    // Ids are generated inside the data layer, in the same transaction that inserts
    // the trip and its members.
    const trip = await createTrip({
      name: name.trim().slice(0, 100),
      currency,
      members: members.map((m: { name: string }, i: number) => ({
        name: m.name.trim(),
        emoji: EMOJIS[i % EMOJIS.length],
      })),
      ownerId: user?.id,
    });

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
    // Only ever the caller's own trips: there is no endpoint that lists everyone's.
    const user = await getCurrentUser();
    const trips = await listTrips(user?.id);
    return NextResponse.json({ trips });
  } catch (error) {
    console.error("List trips error:", error);
    return NextResponse.json({ error: "Failed to list trips" }, { status: 500 });
  }
}