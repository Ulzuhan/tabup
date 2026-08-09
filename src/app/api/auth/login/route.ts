import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import {
  authenticate,
  clearAttempts,
  clientKey,
  createSession,
  publicUser,
  recordAttempt,
  tooManyAttempts,
} from "@/lib/auth";
import { redeemInvite } from "@/lib/store";

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string; inviteToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Throttled per address and per account, so one attacker cannot lock everyone out by
  // hammering a single inbox, and one IP cannot spray many accounts.
  const ipKey = clientKey(request, "login");
  const accountKey = `account:${email.toLowerCase()}`;
  if (tooManyAttempts(ipKey) || tooManyAttempts(accountKey)) {
    return fail("throttled", 429);
  }

  recordAttempt(ipKey);
  recordAttempt(accountKey);

  const user = await authenticate(email, password);
  if (!user) {
    // One message for both cases: which half was wrong is not the caller's business.
    return fail("wrong_credentials", 401);
  }

  // Told apart from a wrong password on purpose: somebody waiting on approval needs to
  // know that is what is happening, not that their password is wrong.
  if (user.approvedAt == null) {
    return fail("pending_approval", 403);
  }

  // Both counters, not just the account's. The IP key is shared by everyone the server
  // cannot tell apart — behind a proxy that sets no headers, that is every single
  // caller — so leaving it to accumulate on success meant correct sign-ins piling up
  // until the instance locked out the people using it properly.
  clearAttempts(accountKey);
  clearAttempts(ipKey);


  await createSession(user.id);

  let joinedTripId: string | null = null;
  if (typeof body.inviteToken === "string") {
    const joined = await redeemInvite(body.inviteToken, user);
    joinedTripId = joined?.tripId ?? null;
  }

  return NextResponse.json({ user: publicUser(user), tripId: joinedTripId });
}
