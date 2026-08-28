import { NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth";
import { getTrip, listRecurring, listTrips, readActivity } from "@/lib/store";
import { logError } from "@/lib/errors";

/**
 * Todo lo tuyo, en un fichero.
 *
 * Había CSV por grupo y un export de gastos fijos, así que llevarse los datos era
 * posible a trozos y sabiendo dónde mirar. Esto es el hermano de «borrar mi cuenta»:
 * quien puede irse tiene que poder llevarse lo suyo primero, y en un solo gesto.
 *
 * JSON y no CSV a propósito. Un CSV obliga a aplanar —un gasto tiene un reparto, y un
 * reparto es una lista— y lo que se pierde al aplanar es justamente lo que hace falta
 * para reconstruir nada. Esto sale con la forma que tienen los datos por dentro.
 *
 * Qué lleva: los grupos que puedes abrir, enteros —gastos, repartos, pagos, personas y
 * el historial de lo que pasó— y tus gastos fijos, que no son de ningún grupo. Lo que
 * NO lleva son las fotos de los recibos: son ficheros y esto es un JSON; están donde
 * siempre, a un clic en cada gasto.
 *
 * Los grupos van completos aunque no sean tuyos, porque tus cifras están dentro de los
 * de otra gente: un export que solo trajera los grupos que creaste dejaría fuera la
 * mitad de tu dinero. Es exactamente lo que ya puedes ver en pantalla, ni un dato más.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("signin_required", 401);

  try {
    const resumen = await listTrips(user.id);
    const grupos = [];
    for (const t of resumen) {
      const trip = await getTrip(t.id);
      if (trip) grupos.push({ ...trip, activity: readActivity(t.id, 500) });
    }

    const salida = {
      exportedAt: new Date().toISOString(),
      // Sin la contraseña ni el `sub` del proveedor: lo primero es un hash y lo
      // segundo un identificador de otra casa. Ninguno le sirve a nadie aquí.
      account: {
        email: user.email,
        name: user.name,
        emoji: user.emoji,
        defaultCurrency: user.defaultCurrency,
        payTo: user.payTo,
        createdAt: new Date(user.createdAt).toISOString(),
      },
      trips: grupos,
      recurring: await listRecurring(user.id),
    };

    return new NextResponse(JSON.stringify(salida, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Nombre de fichero por si se abre a pelo; el navegador de la aplicación le
        // pone el suyo con la fecha.
        "Content-Disposition": 'attachment; filename="tabup-export.json"',
        // Un volcado de datos personales no se cachea en ningún sitio del camino.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logError("GET /api/account/export", error);
    return fail("save_failed", 500);
  }
}
