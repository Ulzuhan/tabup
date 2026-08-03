import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { atTripLimit, claimTrip, FREE_TRIP_LIMIT, isValidId } from "@/lib/store";

/**
 * Attaches an anonymous trip to the signed-in account.
 *
 * Only trips that still have no owner can be claimed, so this cannot be used to take
 * someone else's trip by guessing its id.
 */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/trips/[id]/claim">) {
  const { id } = await ctx.params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (atTripLimit(user)) {
    return NextResponse.json(
      { error: `This account is capped at ${FREE_TRIP_LIMIT} trips.`, code: "trip_limit" },
      { status: 402 }
    );
  }

  const claimed = await claimTrip(id, user.id);
  if (!claimed) {
    return NextResponse.json(
      { error: "This trip already belongs to an account" },
      { status: 409 }
    );
  }
  return NextResponse.json({ success: true });
}
