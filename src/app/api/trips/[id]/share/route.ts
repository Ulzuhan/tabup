import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { normalizeEmail } from "@/lib/auth";
import { grantAccess, listCollaborators, revokeAccess } from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";

/**
 * Sharing an owned trip with another account.
 *
 * Anonymous trips are shared by sending the link and have no collaborator list, so
 * these endpoints only apply once a trip has an owner.
 */

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/trips/[id]/share">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ collaborators: listCollaborators(id) });
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

  return NextResponse.json({ collaborators: listCollaborators(id) });
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
  return NextResponse.json({ collaborators: listCollaborators(id) });
}
