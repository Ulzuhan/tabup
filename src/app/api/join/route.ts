import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readInvite, redeemInvite } from "@/lib/store";

/** What an invitation points at, so the join page can name the trip before signing in. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const invite = readInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "expired" }, { status: 404 });
  }

  const user = await getCurrentUser();
  return NextResponse.json({
    tripName: invite.tripName,
    signedIn: Boolean(user),
    userName: user?.name ?? null,
    // Set when the link was made for one person: the page can say which seat is
    // waiting instead of only naming the trip.
    memberName: invite.memberName ?? null,
  });
}

/** Redeems it for whoever is signed in. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let token = "";
  try {
    ({ token } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const joined = await redeemInvite(token, user);
  if (!joined) {
    return NextResponse.json({ error: "expired" }, { status: 404 });
  }

  // `memberId` is null only when the trip still holds names typed before they arrived
  // and one of them may be theirs; the trip screen asks. Otherwise they are already in.
  return NextResponse.json(joined);
}
