import { NextResponse } from "next/server";
import { getCurrentUser, publicUser, registrationOpen } from "@/lib/auth";
import { FREE_TRIP_LIMIT, ownedTripCount } from "@/lib/store";

/** Who is signed in, and how much of the free plan they have used. */
export async function GET() {
  const user = await getCurrentUser();
  // Reported so the sign-in screen can hide a path that would only end in a refusal.
  if (!user) return NextResponse.json({ user: null, registrationOpen: registrationOpen() });

  return NextResponse.json({
    user: publicUser(user),
    usage: {
      trips: ownedTripCount(user.id),
      // null means no cap, which is the default.
      tripLimit: user.plan === "free" ? FREE_TRIP_LIMIT : null,
    },
  });
}
