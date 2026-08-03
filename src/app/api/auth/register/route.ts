import { NextRequest, NextResponse } from "next/server";
import {
  clientKey,
  createSession,
  createUser,
  isValidEmail,
  passwordProblem,
  publicUser,
  recordAttempt,
  registrationOpen,
  tooManyAttempts,
} from "@/lib/auth";
import { claimTrip, isValidId } from "@/lib/store";

/**
 * Creates an account.
 *
 * `claimTripIds` is the conversion path: someone who has been using the app anonymously
 * sends the trip ids their browser remembers, and the ones that still have no owner
 * become theirs. Trips already owned by someone else are silently left alone.
 */
export async function POST(request: NextRequest) {
  // Closed by default once the instance has an owner. This is reachable from the
  // internet, and an open registration endpoint on a personal instance means anyone
  // who finds the URL can create accounts on it. The first account is always allowed
  // so a fresh install can be set up; after that, opening it up is a deliberate act.
  if (!registrationOpen()) {
    return NextResponse.json(
      { error: "Registration is closed on this instance" },
      { status: 403 }
    );
  }

  const throttleKey = clientKey(request, "register");
  if (tooManyAttempts(throttleKey)) {
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  let body: { email?: string; name?: string; password?: string; claimTripIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (name.length === 0 || name.length > 80) {
    return NextResponse.json({ error: "Name must be 1-80 characters" }, { status: 400 });
  }
  const problem = passwordProblem(password);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  recordAttempt(throttleKey);

  const user = await createUser(email, name, password);
  if (!user) {
    return NextResponse.json({ error: "That email is already registered" }, { status: 409 });
  }

  let claimed = 0;
  if (Array.isArray(body.claimTripIds)) {
    for (const id of body.claimTripIds.slice(0, 50)) {
      if (typeof id === "string" && isValidId(id) && (await claimTrip(id, user.id))) claimed++;
    }
  }

  await createSession(user.id);
  return NextResponse.json({ user: publicUser(user), claimed });
}
