/**
 * OIDC client for Authentik (authorization code flow with PKCE).
 *
 * Hand-written and dependency-free: it is a handful of well-defined requests,
 * and pulling in a whole authentication library for this would add more
 * surface than the code it replaces.
 *
 * Two addresses for the same Authentik, on purpose:
 *
 *   PUBLIC     the one the browser is sent to (auth.kaicorplabs.com). It has to
 *              be reachable from the phone of whoever is signing in.
 *   INTERNAL   the one this server uses to redeem the code and read the user's
 *              details (127.0.0.1). No point going out to the internet and back
 *              to talk to a process on the same machine.
 *
 * The ID token is NOT signature-checked: it arrives from the token endpoint in
 * a direct server-to-server call, which is the case where the specification
 * itself (OIDC Core 3.1.3.7) allows skipping that check. The user's details are
 * read from /userinfo anyway.
 */
import { createHash, randomBytes } from "crypto";

export interface OidcConfig {
  publicBase: string;
  internalBase: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Slug de la aplicación en el proveedor. Solo lo usa el cierre de sesión. */
  appSlug: string;
}

function validUrl(raw: string | undefined, { allowHttp = false } = {}): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !((allowHttp || loopback) && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch { return null; }
}

export function oidcConfig(): OidcConfig | null {
  const clientId = process.env.TABUP_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.TABUP_OIDC_CLIENT_SECRET?.trim();
  // Sin proveedor por defecto: cada URL llega por entorno y se valida. El
  // default anterior era nuestro IdP, y quien desplegara esto en otro sitio lo
  // heredaba sin saberlo. INTERNAL cae a PUBLIC si no se fija, que es lo
  // correcto cuando el proveedor no comparte máquina con la aplicación.
  const publicBase = validUrl(process.env.TABUP_OIDC_PUBLIC_BASE);
  // La pata interna admite http con cualquier hostname: es el tramo
  // servidor→proveedor, y un alias de red de contenedores (authentik-server)
  // o un nombre de LAN son el caso normal — exigir loopback aquí dejaba el
  // login en 503 dentro de un contenedor (medido en QR-Forge). El https
  // obligatorio sigue intacto para todo lo que visita el navegador.
  const internalBase = validUrl(process.env.TABUP_OIDC_INTERNAL_BASE ?? process.env.TABUP_OIDC_PUBLIC_BASE, { allowHttp: true });
  const redirectUri = validUrl(process.env.TABUP_OIDC_REDIRECT_URI);

  // El cierre de sesión de Authentik cuelga del slug con el que se dio de alta
  // la aplicación, y ese slug lo elige quien la despliega. Estaba escrito a mano:
  // correcto aquí, roto para cualquiera que la registre con otro nombre. El
  // valor por defecto mantiene el comportamiento actual.
  const appSlug = (process.env.TABUP_OIDC_APP_SLUG ?? "tabup").trim().replace(/^\/+|\/+$/g, "");

  if (!clientId || !clientSecret || !publicBase || !internalBase || !redirectUri) return null;
  return { publicBase, internalBase, clientId, clientSecret, redirectUri, appSlug };
}

/** With no configuration there is no way in: the app cannot let anybody through. */
export function oidcConfigured(): boolean {
  return oidcConfig() !== null;
}

const APP_PATH = "/application/o";

export function authorizeUrl(
  cfg: OidcConfig,
  { state, codeChallenge }: { state: string; codeChallenge: string }
): string {
  const url = new URL(`${cfg.publicBase}${APP_PATH}/authorize/`);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function endSessionUrl(cfg: OidcConfig): string {
  // Sin `post_logout_redirect_uri` a propósito. Volver a la aplicación
  // exigiría mandar `id_token_hint` —Authentik lo pide, es requisito de
  // certificación OIDC— y eso significaría guardar el id_token de cada
  // sesión: cambio de esquema donde la sesión vive en base de datos, y ~1 KB
  // más de cookie en CADA petición donde vive en la cookie. Demasiado coste
  // permanente para un detalle estético.
  //
  // Sin él, el proveedor cierra la sesión y deja al usuario en la pantalla
  // de entrada de KaiCorp Labs, que pide credenciales: exactamente la señal
  // de que ha salido de verdad.
  return `${cfg.publicBase}${APP_PATH}/${cfg.appSlug}/end-session/`;
}

// ─── PKCE ───────────────────────────────────────────────────────────
export function newVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ─── Code for identity ──────────────────────────────────────────────
/**
 * Lo que se espera al proveedor antes de rendirse.
 *
 * Sin esto no hay ninguno: el `fetch` de Node no trae tiempo límite por defecto,
 * así que un proveedor que acepta la conexión y luego calla deja retenido el
 * manejador de la petición indefinidamente. Y esto está en el camino de entrada
 * —cada intento de login pasa por aquí—, de modo que basta con que se cuelgue
 * para ir comiéndose los manejadores del servidor. Diez segundos sobran para una
 * máquina que está en este mismo equipo.
 */
const OIDC_TIMEOUT_MS = Number(process.env.TABUP_OIDC_TIMEOUT || 10_000);

export interface OidcIdentity {
  sub: string;
  email: string;
  name?: string;
}

export async function exchangeCode(
  cfg: OidcConfig,
  { code, verifier }: { code: string; verifier: string }
): Promise<OidcIdentity> {
  const res = await fetch(`${cfg.internalBase}${APP_PATH}/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`token endpoint: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const tokens = (await res.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("token endpoint: no access_token");

  const info = await fetch(`${cfg.internalBase}${APP_PATH}/userinfo/`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
  });
  if (!info.ok) {
    throw new Error(`userinfo: ${info.status}`);
  }

  const claims = (await info.json()) as { sub?: string; email?: string; name?: string };
  if (!claims.sub || !claims.email) {
    throw new Error("userinfo: missing sub or email");
  }

  return { sub: claims.sub, email: claims.email.toLowerCase(), name: claims.name };
}

/**
 * Destino interno seguro tras iniciar sesión.
 *
 * La comprobación anterior era `startsWith("/") && !startsWith("//")`, y se
 * escapaba: **los navegadores normalizan `\` a `/` dentro de las URLs**, así que
 * `/\evil.com` empieza por una sola barra —pasa el filtro— pero el navegador lo
 * resuelve como `//evil.com`, o sea protocolo relativo hacia un dominio ajeno.
 * Iniciar sesión se convertía en un redirector a donde quisiera quien mandara
 * el enlace. Verificado en producción antes de arreglarlo: la cookie guardaba
 * `"next":"/\\evil.com"` sin rechistar.
 *
 * Los caracteres de control se quitan **antes** de decidir, no después: el
 * navegador también los descarta al resolver la URL, así que comprobar sobre la
 * cadena sucia estaría mirando una URL distinta de la que se va a seguir.
 *
 * Vive aquí y no en cada ruta porque estaba duplicado, y dos copias de una
 * comprobación de seguridad acaban divergiendo.
 */
export function safeNext(raw: string | undefined | null): string {
  if (!raw) return "/";
  const limpio = raw.replace(/[\u0000-\u001F\u007F]/g, "");
  if (!limpio.startsWith("/")) return "/";
  if (limpio.startsWith("//") || limpio.startsWith("/\\")) return "/";
  return limpio;
}
