import { NextRequest, NextResponse } from "next/server";
import { readActivity } from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";

/**
 * What has happened in a trip, newest first.
 *
 * The permission model says everyone answers for what they entered and the owner can
 * change anything. Neither half means much unless it can be seen: a rule about
 * responsibility that leaves no trace is a promise, not a record — and the owner's power
 * to rewrite anybody's figures is exactly the kind of thing that should not be silent.
 *
 * Its own endpoint rather than part of the trip: the feed is only worth fetching when
 * somebody opens the tab, and folding it into every trip read would put it in the offline
 * cache of every device on every load, for a list nobody looks at most days.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ entries: readActivity(id) });
}
