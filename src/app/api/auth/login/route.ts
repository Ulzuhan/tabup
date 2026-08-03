import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  clearAttempts,
  clientKey,
  createSession,
  publicUser,
  recordAttempt,
  tooManyAttempts,
} from "@/lib/auth";
import { claimTrip, isValidId, redeemInvite } from "@/lib/store";

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string; claimTripIds?: unknown; inviteToken?: string };
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
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  recordAttempt(ipKey);
  recordAttempt(accountKey);

  const user = await authenticate(email, password);
  if (!user) {
    // One message for both cases: which half was wrong is not the caller's business.
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }

  clearAttempts(accountKey);

  let claimed = 0;
  if (Array.isArray(body.claimTripIds)) {
    for (const id of body.claimTripIds.slice(0, 50)) {
      if (typeof id === "string" && isValidId(id) && (await claimTrip(id, user.id))) claimed++;
    }
  }

  await createSession(user.id);

  let joinedTripId: string | null = null;
  if (typeof body.inviteToken === "string") {
    joinedTripId = await redeemInvite(body.inviteToken, user.id);
  }

  return NextResponse.json({ user: publicUser(user), claimed, tripId: joinedTripId });
}
