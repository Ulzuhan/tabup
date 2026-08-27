import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { createInvite } from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";
import { isSameOriginMutation } from "@/lib/request-origin";

/**
 * Creates an invitation link. Owners only.
 *
 * There is nothing to choose any more: whoever opens it joins the trip, which means a
 * seat in the split and the run of their own expenses. It used to carry a role, so a
 * QR code that looked identical either handed over the trip or did not, and neither
 * kind put the person who scanned it into the arithmetic.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/invite">) {
  // Esta ruta no lee el cuerpo, así que la exigencia de `application/json` que
  // protege a las demás no la cubre: una página hermana puede lanzarle una
  // petición simple y el navegador manda la cookie, porque compartir dominio los
  // hace el mismo sitio. Comprobado: devolvía 200 y creaba la invitación.
  //
  // No se lee el enlace desde fuera —la respuesta no se puede mirar sin permiso—
  // pero sí se pueden crear invitaciones a un viaje ajeno sin parar.
  if (!isSameOriginMutation(request)) return fail("cross_origin", 403);

  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "own");
  if (!auth.ok) return auth.response;

  const invite = await createInvite(id);
  if (!invite) {
    return fail("save_failed", 500);
  }

  return NextResponse.json(invite);
}
