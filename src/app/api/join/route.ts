import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { jsonBody } from "@/lib/body";
import { getCurrentUser } from "@/lib/auth";
import { redeemInvite } from "@/lib/store";

/**
 * Aquí hubo un GET que contaba a qué grupo apunta un token, para que la página de
 * invitación pudiera nombrarlo antes de que nadie entrase. Ya no hace falta: esa
 * página se resuelve en el servidor y lee la invitación directamente, así que este
 * endpoint no tenía ningún llamante — y era además una lectura sin sesión que
 * devolvía el nombre de un grupo ajeno a quien probase tokens.
 */

/** Redeems it for whoever is signed in. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return fail("signin_required", 401);
  }

  const cuerpo = await jsonBody(request);
  if (!cuerpo) return fail("bad_json", 400);
  const { token } = cuerpo;

  const joined = await redeemInvite(token, user);
  if (!joined) {
    return fail("invite_expired", 404);
  }

  // `memberId` is null only when the trip still holds names typed before they arrived
  // and one of them may be theirs; the trip screen asks. Otherwise they are already in.
  return NextResponse.json(joined);
}
