import { NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
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
      response: fail("not_found", 404),
    };
  }

  if (need === "write" && !canWrite(level)) {
    return {
      ok: false,
      response: fail("not_allowed", 403),
    };
  }

  // Deleting, resharing and inviting are the owner's alone.
  if (need === "own" && level !== "owner") {
    return {
      ok: false,
      response: fail("owner_only", 403),
    };
  }

  return { ok: true, level, user };
}
