import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import {
  clearAttempts,
  isApproved,
  clientKey,
  createSession,
  passwordProblem,
  readPasswordReset,
  recordAttempt,
  tooManyAttempts,
  redeemPasswordReset,
} from "@/lib/auth";
import { logError } from "@/lib/errors";
import { oidcConfigured } from "@/lib/oidc";

/**
 * Setting a new password from a link the admin handed out.
 *
 * No session is needed, and that is the whole point: somebody who cannot get in cannot
 * be asked to sign in first. The token *is* the credential for this one act — which is
 * why it is single-use, expires within the hour, and takes every existing session of
 * that account with it when it is spent.
 *
 * Throttled per IP even though the token is 32 random bytes and guessing it is not a
 * realistic attack: the cost is four lines, and an endpoint that will hash a password
 * for anyone who asks is worth not leaving open to being hammered.
 */

/** What the link is worth, so the page can say something useful before asking anything. */
export async function GET(request: NextRequest) {
  if (oidcConfigured()) return fail("not_found", 404);

  const token = request.nextUrl.searchParams.get("token") ?? "";
  const reset = readPasswordReset(token);
  // The address is shown so the person can see whose account they are about to change —
  // a link forwarded to the wrong person should be obvious to them, not a surprise.
  return NextResponse.json({ state: reset.state, email: reset.email, name: reset.name });
}

export async function POST(request: NextRequest) {
  if (oidcConfigured()) return fail("not_found", 404);

  const key = clientKey(request, "reset");
  if (tooManyAttempts(key)) {
    return fail("throttled", 429);
  }

  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return fail("bad_json", 400);
  }

  const password = String(body.password ?? "");
  const problem = passwordProblem(password);
  if (problem) return fail(problem, 400);

  try {
    const result = await redeemPasswordReset(String(body.token ?? ""), password);
    if (result.state !== "ok") {
      recordAttempt(key);
      // `code` as well as `error`, like every other route: the page turns it into a
      // sentence, and "expired" was never a sentence in anybody's language.
      // Este no pasa por fail(): el código no es fijo, sale del estado del token
      // (expired | used | unknown), y ya viaja con la misma forma que fail() produce.
      return NextResponse.json({ error: result.state, code: result.state }, { status: 400 });
    }

    clearAttempts(key);

    /**
     * Signed in straight away — unless they were never let in to begin with.
     *
     * Choosing a password is proof of holding the link, not of having been approved, and
     * this used to hand out a session either way: an account still sitting in the queue
     * could be walked straight past it by a reset link. Rare, since only the admin issues
     * one, but "rare" is not the same as "cannot". The password change stands, because
     * that is what the link was for; what does not follow is the session.
     */
    if (!isApproved(result.user!)) {
      return NextResponse.json({ ok: true, pending: true });
    }

    await createSession(result.user!.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("POST /api/auth/reset", error);
    return fail("save_failed", 500);
  }
}
