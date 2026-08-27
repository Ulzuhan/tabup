import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { jsonBody } from "@/lib/body";
import {
  authenticate,
  clearAttempts,
  clientAddress,
  createSession,
  publicUser,
  recordAttempt,
  tooManyAttempts,
} from "@/lib/auth";
import { redeemInvite } from "@/lib/store";
import { oidcConfigured } from "@/lib/oidc";

export async function POST(request: NextRequest) {
  if (oidcConfigured()) return fail("not_found", 404);

  // `null` es JSON válido: pasaba el catch y reventaba al leer un campo.
  const body: { email?: string; password?: string; inviteToken?: string } | null = await jsonBody(request);
  if (!body) return fail("bad_json", 400);

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Throttled per address and per account, so one attacker cannot lock everyone out by
  // hammering a single inbox, and one IP cannot spray many accounts.
  // Sólo por dirección cuando hay una dirección. Detrás de un proxy que no pone
  // cabeceras, todos los que llaman son indistinguibles y compartirían contador:
  // diez fallos de cualquiera cerraban la instancia entera durante quince minutos,
  // sin salida, porque el contador se limpia al acertar y acertar estaba bloqueado.
  // El contador por cuenta —que es el que frena probar contraseñas de verdad—
  // sigue puesto siempre.
  const direccion = clientAddress(request);
  const ipKey = direccion ? `${direccion}:login` : null;
  const accountKey = `account:${email.toLowerCase()}`;
  if ((ipKey && tooManyAttempts(ipKey)) || tooManyAttempts(accountKey)) {
    return fail("throttled", 429);
  }

  if (ipKey) recordAttempt(ipKey);
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
  if (ipKey) clearAttempts(ipKey);


  await createSession(user.id);

  let joinedTripId: string | null = null;
  if (typeof body.inviteToken === "string") {
    const joined = await redeemInvite(body.inviteToken, user);
    joinedTripId = joined?.tripId ?? null;
  }

  return NextResponse.json({ user: publicUser(user), tripId: joinedTripId });
}
