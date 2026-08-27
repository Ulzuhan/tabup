import type { NextRequest } from "next/server";

/**
 * De dónde se considera que viene esta petición.
 *
 * Se toma la cabecera `Host` y no `X-Forwarded-Host`, y la diferencia importa:
 * `X-Forwarded-Host` la puede escribir quien llama, y **este despliegue no la
 * reemplaza**. Comprobado en vivo contra el túnel: mandando
 * `X-Forwarded-Host: malo.example` junto con `Origin: https://malo.example`, la
 * cabecera llegaba intacta a la aplicación mientras `Host` seguía valiendo
 * `tabup.kaicorplabs.com`. Prefiriendo la primera, la comprobación de origen se
 * saltaba sola.
 *
 * `Host` sí lo pone el túnel y una página no puede falsearlo: en una petición a
 * otro sitio la escribe el navegador, y una cabecera inventada convertiría la
 * petición en una que necesita permiso previo, que es justo lo que aquí no se da.
 *
 * `TABUP_PUBLIC_HOST` existe para el caso contrario: un proxy que sí reescriba
 * `Host` con el nombre interno. Sin ponerla, se usa lo que llega.
 */
function hostDeConfianza(request: NextRequest): string | null {
  return process.env.TABUP_PUBLIC_HOST?.trim() || request.headers.get("host");
}

/** Refuses browser mutations initiated by another origin. */
export function isSameOriginMutation(request: NextRequest): boolean {
  // Fetch Metadata primero, que es lo que de verdad separa a los hermanos: dos
  // subdominios del mismo dominio son `same-site` para el navegador, y la cookie
  // viaja igual. `none` es una navegación escrita a mano.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = request.headers.get("origin");
  // Sin `Origin` no hay navegador detrás, y sin navegador no hay cookie ajena que
  // aprovechar. Es lo que deja pasar a curl y a las suites.
  if (!origin) return true;

  const host = hostDeConfianza(request);
  if (!host) return false;

  // El esquema sale de `nextUrl`, que Next reconstruye. No es una vía para
  // cruzar orígenes —haría falta un `Origin` con este mismo host— pero
  // compararlo cuesta nada.
  const protocol = request.nextUrl.protocol.replace(":", "");
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}
