import { NextRequest, NextResponse } from "next/server";
import { claimMember, logActivity, memberForUser, seatUser, unlinkedMembers } from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";
import { logError } from "@/lib/errors";

/**
 * Saying which participant you are.
 *
 * Access to a trip and being one of the people it splits between were never the same
 * thing, and until now only the first was modelled: somebody who accepted an invitation
 * could read the trip and add expenses while appearing in nobody's split, unless the
 * owner had separately typed a name — one with no connection to their account, so the
 * app could not tell that "Andoni" was the person reading the page.
 *
 * The choice is offered rather than guessed. The names were typed by somebody else, and
 * matching them to accounts by spelling would be a guess about money. It is also what
 * makes every trip created before any of this reachable: all of their members are bare
 * text, and without a claim they would stay that way for good.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;
  if (!auth.user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const mine = memberForUser(id, auth.user.id);
  return NextResponse.json({
    you: mine?.id ?? null,
    candidates: mine ? [] : unlinkedMembers(id),
  });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Read access is enough: this is about identity, not about writing anything of
  // consequence. A read-only guest is still a person the trip may owe money to.
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;
  if (!auth.user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let body: { memberId?: string; create?: boolean; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Already seated: answering twice is a stale tab, not an error worth showing.
  const existing = memberForUser(id, auth.user.id);
  if (existing) return NextResponse.json({ member: existing });

  try {
    if (body.create) {
      // Nobody on the list is them, so they join as themselves — under the name they
      // chose for this trip, or their account's if they did not bother. Either way the
      // column belongs to an account, which is the part that matters.
      const alias = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
      const member = await seatUser(id, { id: auth.user.id, name: alias || auth.user.name });
      if (!member) return NextResponse.json({ error: "Could not add you" }, { status: 500 });
      logActivity(id, auth.user, "memberJoined", member.name);
      return NextResponse.json({ member });
    }

    if (typeof body.memberId !== "string") {
      return NextResponse.json({ error: "memberId or create required" }, { status: 400 });
    }

    const member = claimMember(id, body.memberId, auth.user.id);
    if (!member) {
      // Somebody else got there first, or the name is not free any more.
      return NextResponse.json({ error: "That person is already taken" }, { status: 409 });
    }
    logActivity(id, auth.user, "memberClaimed", member.name);
    return NextResponse.json({ member });
  } catch (error) {
    logError("POST /api/trips/[id]/claim", error);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}
