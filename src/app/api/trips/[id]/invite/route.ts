import { NextRequest, NextResponse } from "next/server";
import { createInvite } from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";

/** Creates an invitation link. Owners only, and only for a trip that has one. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/invite">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "own");
  if (!auth.ok) return auth.response;

  let role: "viewer" | "editor" = "editor";
  try {
    const body = await request.json();
    if (body?.role === "viewer") role = "viewer";
  } catch {
    // No body is fine; editor is the sensible default for someone joining a trip.
  }

  const invite = await createInvite(id, role);
  if (!invite) {
    return NextResponse.json({ error: "Could not create the invitation" }, { status: 500 });
  }

  return NextResponse.json(invite);
}
