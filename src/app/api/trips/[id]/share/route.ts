import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { normalizeEmail } from "@/lib/auth";
import {
  addMember,
  getTrip,
  grantAccess,
  memberForUser,
  memberNameTaken,
  revokeAccess,
  visibleCollaborators,
} from "@/lib/store";
import { EMOJIS } from "@/lib/types";
import { authorizeTrip } from "@/lib/authorize";

/**
 * Sharing a trip with another account.
 *
 * Letting somebody in and seating them in the split are done together: they used to be
 * separate lists that knew nothing of each other, so the same person could be a
 * collaborator by email *and* a line of text in the members list, with nothing tying
 * the two together.
 */

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/trips/[id]/share">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    collaborators: visibleCollaborators(id, {
      id: auth.user?.id,
      isOwner: auth.level === "owner",
    }),
  });
}

// POST — grant access by email
export async function POST(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/share">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "own");
  if (!auth.ok) return auth.response;

  if (!auth.user) {
    return NextResponse.json(
      { error: "Claim this trip to an account before sharing it" },
      { status: 403 }
    );
  }

  let body: { email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (email === auth.user.email) {
    return NextResponse.json({ error: "You already own this trip" }, { status: 400 });
  }

  const target = db.select().from(users).where(eq(users.email, email)).get();
  if (!target) {
    // Saying so is the useful answer here: the owner typed the address themselves and
    // needs to know it does not exist yet.
    return NextResponse.json({ error: "No account with that email" }, { status: 404 });
  }

  const role = body.role === "viewer" ? "viewer" : "editor";
  const granted = await grantAccess(id, target.id, role);
  if (!granted) {
    return NextResponse.json({ error: "Failed to share trip" }, { status: 500 });
  }

  // Seated as well as let in, unless they already have a place in this trip — an
  // existing participant they claimed earlier, for instance.
  if (!memberForUser(id, target.id)) {
    const trip = await getTrip(id);
    let name = target.name.slice(0, 50);
    for (let n = 2; memberNameTaken(id, name); n++) name = `${target.name.slice(0, 46)} ${n}`;
    await addMember(id, name, EMOJIS[(trip?.members.length ?? 0) % EMOJIS.length], target.id);
  }

  return NextResponse.json({
    collaborators: visibleCollaborators(id, { id: auth.user.id, isOwner: true }),
    members: (await getTrip(id))?.members ?? [],
  });
}

// DELETE — revoke access
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/share">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "own");
  if (!auth.ok) return auth.response;

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const removed = await revokeAccess(id, body.userId);
  if (!removed) {
    return NextResponse.json({ error: "That account has no access" }, { status: 404 });
  }

  // Their seat stays. Taking away someone's access is not a statement that they were
  // never at the table, and deleting the member would take their expenses with it.
  return NextResponse.json({
    collaborators: visibleCollaborators(id, { id: auth.user?.id, isOwner: true }),
  });
}
