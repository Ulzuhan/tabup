import { NextRequest, NextResponse } from "next/server";
import {
  destroySession,
  getCurrentUser,
  isAdmin,
  pendingUsers,
  publicUser,
  registrationOpen,
  verifyPassword,
} from "@/lib/auth";
import { deleteAccount, FREE_TRIP_LIMIT, ownedTripCount } from "@/lib/store";
import { fail } from "@/lib/api-error";
import { logError } from "@/lib/errors";

/** Who is signed in, and how much of the free plan they have used. */
export async function GET() {
  const user = await getCurrentUser();
  // Reported so the sign-in screen can hide a path that would only end in a refusal.
  if (!user) return NextResponse.json({ user: null, registrationOpen: registrationOpen() });

  return NextResponse.json({
    user: { ...publicUser(user), admin: isAdmin(user) },
    // Surfaced here so the header can badge the menu without a second request.
    pendingApprovals: isAdmin(user) ? pendingUsers().length : 0,
    usage: {
      trips: ownedTripCount(user.id),
      // null means no cap, which is the default.
      tripLimit: user.plan === "free" ? FREE_TRIP_LIMIT : null,
    },
  });
}

/**
 * Closing your own account.
 *
 * The password is asked for again, and it is not a formality: a session is whoever is
 * holding the phone, and an unlocked phone left on a table should not be enough to delete
 * somebody's spending for good. It is the same reason a bank asks twice.
 *
 * What happens to the trips is in `deleteAccount`. The short version, which the dialog
 * says out loud before anyone taps it: groups they run go to whoever else has been in them
 * longest, groups nobody else is in go with them, and the column of figures they left in
 * other people's groups stays exactly where it is.
 */
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("signin_required", 401);

  let password = "";
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof password !== "string" || !(await verifyPassword(password, user.passwordHash))) {
    return fail("wrong_credentials", 403);
  }

  try {
    const outcome = await deleteAccount(user.id);
    // The cookie goes too. The session row is already gone with the account, so this is
    // only about not leaving a dead token in the browser.
    await destroySession();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    logError("DELETE /api/auth/me", error);
    return fail("save_failed", 500);
  }
}
