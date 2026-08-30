import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { destroyAllSessions } from "@/lib/auth";
import { verificarCierre } from "@/lib/backchannel";
import { oidcConfig } from "@/lib/oidc";

/**
 * Donde el proveedor avisa de que una sesión suya ha terminado.
 *
 * La llama el PROVEEDOR, servidor a servidor — nunca un navegador —, así que
 * aquí no hay cookies, ni CSRF, ni origen que comprobar: lo único que
 * autentica esta petición es la firma del `logout_token`, y de eso se encarga
 * `verificarCierre`. Por lo mismo la respuesta no lleva `Set-Cookie` ni
 * cuerpo útil.
 *
 * Se cierran TODAS las sesiones de esa persona y no solo la del `sid` que
 * llega. Es a propósito: este aviso nace de quitarle el acceso a alguien, y
 * dejarle vivas las otras pestañas sería cumplir la letra y no el motivo.
 *
 * Los códigos son los que espera la especificación: 200 si se ha atendido,
 * 400 si el token no vale. Nada de 401/403, que harían que el proveedor
 * reintentara eternamente algo que nunca va a mejorar.
 */
/**
 * Un Logout Token son unos cientos de bytes; 16 KiB es holgado de sobra.
 *
 * POR QUÉ HACE FALTA ESCRIBIRLO: este endpoint es público y no autenticado —lo
 * tiene que ser, lo llama el proveedor—, y `request.text()` se traga entero lo
 * que le manden. App Router no trae límite de cuerpo (eso era `api.bodyParser`
 * del Pages Router), así que sin esto un cuerpo enorme se acumula en memoria.
 * El contenedor tiene tope de memoria y como mucho se reinicia, pero un
 * reinicio provocable desde fuera es una palanca que no hay por qué regalar.
 *
 * Se mira la cabecera Y se cuenta lo que llega: `Content-Length` lo pone quien
 * llama, y quien llama puede mentir.
 */
const LIMITE_CUERPO = 16 * 1024;

async function cuerpoAcotado(request: Request): Promise<string | null> {
  const declarado = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > LIMITE_CUERPO) return null;

  const lector = request.body?.getReader();
  if (!lector) return "";

  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > LIMITE_CUERPO) {
      await lector.cancel();
      return null;
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos).toString("utf8");
}

export async function POST(request: Request): Promise<NextResponse> {
  const cfg = oidcConfig();
  if (!cfg) {
    // Sin proveedor configurado esto no existe para nadie.
    return NextResponse.json({ error: "not_configured" }, { status: 404 });
  }

  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 400 });
  }

  const cuerpo = await cuerpoAcotado(request);
  if (cuerpo === null) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let token: string | null = null;
  try {
    token = new URLSearchParams(cuerpo).get("logout_token");
  } catch {
    token = null;
  }
  if (!token) {
    return NextResponse.json({ error: "missing logout_token" }, { status: 400 });
  }

  let aviso;
  try {
    aviso = await verificarCierre(token, cfg);
  } catch {
    // No se ha podido hablar con el proveedor para comprobar la firma: eso es
    // un fallo nuestro y sí merece que lo reintente.
    return NextResponse.json({ error: "verification unavailable" }, { status: 503 });
  }
  if (!aviso) {
    return NextResponse.json({ error: "invalid logout_token" }, { status: 400 });
  }

  // Sin `sub` no hay a quién echar: el `sid` es del proveedor y aquí no se
  // guarda. Se responde 200 igualmente —el aviso era válido y no hay nada que
  // reintentar— y no se toca ninguna sesión.
  if (aviso.sub) {
    const persona = db.select().from(users).where(eq(users.oidcSub, aviso.sub)).get();
    if (persona) destroyAllSessions(persona.id);
  }

  return NextResponse.json({ ok: true });
}
