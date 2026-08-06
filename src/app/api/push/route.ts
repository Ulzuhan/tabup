import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSubscribed, publicKey, removeSubscription, saveSubscription } from "@/lib/push";
import { logError } from "@/lib/errors";

/**
 * Turning notifications on and off for one browser.
 *
 * The key handed out here is the public half of a pair this instance generated itself —
 * see `lib/push.ts` for what that does and does not depend on.
 */

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  // The browser knows its own endpoint and asks whether this server still has it: a
  // subscription can survive in the browser after the row here is gone, and the toggle
  // has to show what is actually true.
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  return NextResponse.json({
    publicKey: publicKey(),
    subscribed: endpoint ? isSubscribed(user.id, endpoint) : false,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const endpoint = body?.subscription?.endpoint;
    const p256dh = body?.subscription?.keys?.p256dh;
    const auth = body?.subscription?.keys?.auth;

    if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
      return NextResponse.json({ error: "Not a push subscription" }, { status: 400 });
    }

    saveSubscription(user.id, { endpoint, keys: { p256dh, auth } });
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    logError("POST /api/push", error);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  try {
    const { endpoint } = await request.json();
    if (typeof endpoint === "string") removeSubscription(endpoint);
    return NextResponse.json({ subscribed: false });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}
