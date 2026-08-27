import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { jsonBody } from "@/lib/body";
import { getCurrentUser } from "@/lib/auth";
import {
  isSubscribed,
  publicKey,
  pushEndpointProblem,
  removeSubscription,
  saveSubscription,
} from "@/lib/push";
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
    return fail("signin_required", 401);
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
    return fail("signin_required", 401);
  }

  try {
    const body = await jsonBody(request);
    if (!body) return fail("bad_json", 400);
    const endpoint = body?.subscription?.endpoint;
    const p256dh = body?.subscription?.keys?.p256dh;
    const auth = body?.subscription?.keys?.auth;

    if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
      return fail("not_a_subscription", 400);
    }

    // El destino se comprueba aquí, y no más adentro, porque es lo único de esta
    // petición que acaba convertido en una llamada saliente de este servidor.
    if (pushEndpointProblem(endpoint)) {
      return fail("bad_push_endpoint", 400);
    }

    saveSubscription(user.id, { endpoint, keys: { p256dh, auth } });
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    logError("POST /api/push", error);
    return fail("save_failed", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return fail("signin_required", 401);
  }

  try {
    const { endpoint } = await request.json();
    // Scoped to the caller: the endpoint arrives in the body, so on its own it is a claim
    // about a browser rather than proof of owning one.
    if (typeof endpoint === "string") removeSubscription(endpoint, user.id);
    return NextResponse.json({ subscribed: false });
  } catch {
    return fail("bad_json", 400);
  }
}
