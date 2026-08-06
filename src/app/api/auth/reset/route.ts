import { NextRequest, NextResponse } from "next/server";
import {
  clearAttempts,
  clientKey,
  createSession,
  passwordProblem,
  readPasswordReset,
  recordAttempt,
  tooManyAttempts,
  redeemPasswordReset,
} from "@/lib/auth";
import { logError } from "@/lib/errors";

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
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const reset = readPasswordReset(token);
  // The address is shown so the person can see whose account they are about to change —
  // a link forwarded to the wrong person should be obvious to them, not a surprise.
  return NextResponse.json({ state: reset.state, email: reset.email, name: reset.name });
}

export async function POST(request: NextRequest) {
  const key = clientKey(request, "reset");
  if (tooManyAttempts(key)) {
    return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  }

  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const password = String(body.password ?? "");
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const result = await redeemPasswordReset(String(body.token ?? ""), password);
    if (result.state !== "ok") {
      recordAttempt(key);
      return NextResponse.json({ error: result.state }, { status: 400 });
    }

    clearAttempts(key);
    // Signed in straight away: they have just chosen the password, so asking them to
    // type it again on the next screen proves nothing and loses people.
    await createSession(result.userId!);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("POST /api/auth/reset", error);
    return NextResponse.json({ error: "Could not change the password" }, { status: 500 });
  }
}
