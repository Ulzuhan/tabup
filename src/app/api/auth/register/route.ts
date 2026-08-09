import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import {
  clientKey,
  createSession,
  createUser,
  isValidEmail,
  passwordProblem,
  publicUser,
  recordAttempt,
  registrationMode,
  registrationOpen,
  tooManyAttempts,
} from "@/lib/auth";
import { readInvite, redeemInvite } from "@/lib/store";

/**
 * Creates an account.
 *
 * An invitation token, when present, is both permission to register on a closed
 * instance and the trip the new account joins on the way in.
 */
export async function POST(request: NextRequest) {
  // Closed by default once the instance has an owner. This is reachable from the
  // internet, and an open registration endpoint on a personal instance means anyone
  // who finds the URL can create accounts on it. The first account is always allowed
  // so a fresh install can be set up; after that, opening it up is a deliberate act.
  let body: { email?: string; name?: string; password?: string; inviteToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  /**
   * A valid invitation is permission to register.
   *
   * Otherwise the invite flow cannot work at all on a closed instance: the person being
   * invited has no account and no way to make one, which is exactly the dead end a
   * friend hit after scanning a QR code.
   */
  const invite = typeof body.inviteToken === "string" ? readInvite(body.inviteToken) : null;
  const mode = registrationMode();
  const firstEver = registrationOpen() && mode === "closed";

  if (!invite && mode === "closed" && !firstEver) {
    return fail("registration_closed", 403);
  }

  const throttleKey = clientKey(request, "register");
  if (tooManyAttempts(throttleKey)) {
    return fail("throttled", 429);
  }

  const email = typeof body.email === "string" ? body.email : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!isValidEmail(email)) {
    return fail("invalid_email", 400);
  }
  if (name.length === 0 || name.length > 80) {
    return fail("name_length", 400);
  }
  const problem = passwordProblem(password);
  if (problem) return fail(problem, 400);

  recordAttempt(throttleKey);

  /**
   * An invitation is an approval: the person who owns the trip is vouching for them.
   * A plain request in "approval" mode waits for the admin instead.
   */
  const approved = Boolean(invite) || mode === "open";

  const user = await createUser(email, name, password, { approved });
  if (!user) {
    return fail("email_taken", 409);
  }

  // No session for an account nobody has let in yet.
  if (!approved && user.approvedAt == null) {
    return NextResponse.json({ pending: true, user: null });
  }


  await createSession(user.id);

  // Redeemed after the account exists, so the invited person lands already inside.
  let joinedTripId: string | null = null;
  if (invite && typeof body.inviteToken === "string") {
    const joined = await redeemInvite(body.inviteToken, user);
    joinedTripId = joined?.tripId ?? null;
  }

  return NextResponse.json({ user: publicUser(user), tripId: joinedTripId });
}
