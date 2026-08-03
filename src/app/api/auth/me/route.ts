import { NextResponse } from "next/server";
import { getCurrentUser, isAdmin, pendingUsers, publicUser, registrationOpen } from "@/lib/auth";
import { FREE_TRIP_LIMIT, ownedTripCount } from "@/lib/store";

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
