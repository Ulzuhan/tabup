import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { accessLevel, canRead, canWrite, isValidId } from "./store";
import type { Access } from "./store";
import type { UserRow } from "@/db";

/**
 * The single gate every trip route goes through.
 *
 * Returns either the caller's access level or the response to send back. Keeping the
 * refusal here rather than in each handler is what stops a new endpoint from quietly
 * shipping without a check.
 */
export type Authorized =
  | { ok: true; level: Access; user: UserRow | null }
  | { ok: false; response: NextResponse };

export async function authorizeTrip(
  tripId: string,
  need: "read" | "write" | "own"
): Promise<Authorized> {
  if (!isValidId(tripId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 }),
    };
  }

  const user = await getCurrentUser();
  const level = accessLevel(tripId, user?.id);

  // "Not found" for both a missing trip and one the caller may not see: telling them
  // apart would turn the endpoint into a probe for which trip ids exist.
  if (!canRead(level)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Trip not found" }, { status: 404 }),
    };
  }

  if (need === "write" && !canWrite(level)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You have read-only access to this trip" }, { status: 403 }),
    };
  }

  // Deleting or resharing is the owner's alone. An unclaimed trip reports "owner" for
  // anyone holding the link, which is how anonymous use keeps working.
  if (need === "own" && level !== "owner") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Only the trip owner can do that" }, { status: 403 }),
    };
  }

  return { ok: true, level, user };
}
