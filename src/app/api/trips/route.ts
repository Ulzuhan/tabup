import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { atTripLimit, createTrip, FREE_TRIP_LIMIT, listTrips } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import { CURRENCIES, EMOJIS, isTripKind } from "@/lib/types";
import { logError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    // Every trip belongs to an account: there is no anonymous mode, so this is the
    // one place that decides a trip exists at all.
    const user = await getCurrentUser();
    if (!user) {
      return fail("signin_required", 401);
    }
    if (atTripLimit(user)) {
      return fail("trip_limit", 402, { limit: FREE_TRIP_LIMIT });
    }

    const body = await request.json();
    const { name, currency = "EUR", members } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return fail("name_required", 400);
    }

    /**
     * Anyone besides you, and there is no floor.
     *
     * Two names used to be required, which reads as sensible until people arrive by
     * invitation: at the moment of creating the trip you do not yet know what the
     * second person is called, and being made to invent a placeholder for them is
     * exactly the manual naming this is moving away from. One person who invites the
     * rest is the normal way round.
     */
    const extra = Array.isArray(members) ? members : [];
    for (const m of extra) {
      if (typeof m?.name !== "string" || m.name.trim().length === 0 || m.name.trim().length > 50) {
        return fail("member_name_length", 400);
      }
    }
    // The owner is a participant too, so their name counts in the uniqueness check.
    const memberNames = [user.name, ...extra.map((m: { name: string }) => m.name)].map((n) =>
      n.trim().toLowerCase()
    );
    if (new Set(memberNames).size !== memberNames.length) {
      return fail("duplicate_name", 400);
    }

    if (!CURRENCIES.find((c) => c.code === currency)) {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }

    // Ids are generated inside the data layer, in the same transaction that inserts
    // the trip and its members.
    const trip = await createTrip({
      name: name.trim().slice(0, 100),
      kind: isTripKind(body.kind) ? body.kind : "trip",
      currency,
      members: extra.map((m: { name: string }, i: number) => ({
        name: m.name.trim(),
        // Offset by one: the owner already took the first emoji.
        emoji: EMOJIS[(i + 1) % EMOJIS.length],
      })),
      ownerId: user.id,
      ownerName: user.name,
    });

    return NextResponse.json({
      id: trip.id,
      name: trip.name,
      kind: trip.kind,
      members: trip.members,
      createdAt: trip.createdAt,
    });
  } catch (error) {
    logError("POST /api/trips", error);
    return fail("save_failed", 500);
  }
}

export async function GET() {
  try {
    // Only ever the caller's own trips: there is no endpoint that lists everyone's.
    const user = await getCurrentUser();
    if (!user) {
      return fail("signin_required", 401);
    }
    const trips = await listTrips(user.id);
    return NextResponse.json({ trips });
  } catch (error) {
    logError("GET /api/trips", error);
    return fail("save_failed", 500);
  }
}