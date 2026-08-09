import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { createInvite } from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";

/**
 * Creates an invitation link. Owners only.
 *
 * There is nothing to choose any more: whoever opens it joins the trip, which means a
 * seat in the split and the run of their own expenses. It used to carry a role, so a
 * QR code that looked identical either handed over the trip or did not, and neither
 * kind put the person who scanned it into the arithmetic.
 */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/trips/[id]/invite">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "own");
  if (!auth.ok) return auth.response;

  const invite = await createInvite(id);
  if (!invite) {
    return fail("save_failed", 500);
  }

  return NextResponse.json(invite);
}
