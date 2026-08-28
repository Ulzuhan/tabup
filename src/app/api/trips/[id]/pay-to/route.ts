import { NextRequest, NextResponse } from "next/server";
import { authorizeTrip } from "@/lib/authorize";
import { payToFor } from "@/lib/store";

/**
 * Cómo pagarle a alguien de este grupo.
 *
 * El final que le faltaba a saldar cuentas: la aplicación calculaba «debes 23 a Ana» y
 * ahí te soltaba, con el número correcto y ninguna forma de darle los 23. Ana escribe en
 * sus ajustes cómo prefiere cobrar y esto se lo enseña a quien va a pagarle.
 *
 * Ruta aparte y no un campo más del grupo: así se pide a propósito, por una persona y en
 * el momento de pagarle, en vez de viajar con la lista de miembros cada vez que alguien
 * abre el grupo. `authorizeTrip` es quien decide si quien pregunta está dentro; a un
 * desconocido le contesta 404 igual que al resto del grupo.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/pay-to">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  const memberId = request.nextUrl.searchParams.get("member") ?? "";
  return NextResponse.json({ payTo: payToFor(id, memberId) });
}
