/**
 * OIDC client (authorization code flow with PKCE) — provider-agnostic.
 *
 * Hand-written and dependency-free: it is a handful of well-defined requests,
 * and pulling in a whole authentication library for this would add more
 * surface than the code it replaces.
 *
 * NO PROVIDER URL SHAPES LIVE HERE. Every endpoint comes from the provider's
 * own discovery document (`<issuer>/.well-known/openid-configuration`), so
 * this file works against Authentik, Keycloak or anything else that speaks
 * OIDC. It used to hardcode Authentik's `/application/o/...` shape: the app
 * was portable in theory and stuck in practice.
 *
 * Two addresses for the same provider, on purpose:
 *
 *   PUBLIC     where the browser is sent. It has to be reachable from the
 *              phone of whoever is signing in. Taken from the issuer.
 *   INTERNAL   where this server redeems the code and reads the user's
 *              details. No point going out to the internet and back to talk
 *              to a process on the same machine.
 *
 * Discovery is fetched over the INTERNAL address and each endpoint is then
 * pointed at the address its caller can actually reach — the paths are the
 * provider's, the hosts are ours. That is the whole trick.
 *
 * The ID token is NOT signature-checked: it arrives from the token endpoint in
 * a direct server-to-server call, which is the case where the specification
 * itself (OIDC Core 3.1.3.7) allows skipping that check. The user's details are
 * read from /userinfo anyway.
 */
import { createHash, randomBytes } from "crypto";

export interface OidcConfig {
  /** Public issuer URL, exactly as the provider advertises it. */
  issuer: string;
  /** Origin the browser is sent to. Derived from the issuer. */
  publicOrigin: string;
  /** Origin this server uses. Falls back to the public one. */
  internalOrigin: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
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
  // heredaba sin saberlo.
  //
  // El EMISOR es ya la única dirección del proveedor que hace falta: todo lo
  // demás se le pregunta a él por discovery. El origen interno cae al del
  // emisor si no se fija, que es lo correcto cuando el proveedor no comparte
  // máquina con la aplicación.
  const issuer = validUrl(process.env.TABUP_OIDC_ISSUER);
  // La pata interna admite http con cualquier hostname: es el tramo
  // servidor→proveedor, y un alias de red de contenedores (authentik-server) o
  // un nombre de LAN son el caso normal — exigir loopback aquí dejaba el login
  // en 503 dentro de un contenedor (medido en QR-Forge). El https obligatorio
  // sigue intacto para todo lo que visita el navegador.
  const internalOrigin = validUrl(
    process.env.TABUP_OIDC_INTERNAL_BASE?.trim() || (issuer ? new URL(issuer).origin : undefined),
    { allowHttp: true }
  );
  const redirectUri = validUrl(process.env.TABUP_OIDC_REDIRECT_URI);

  if (!clientId || !clientSecret || !issuer || !internalOrigin || !redirectUri) return null;
  return {
    issuer,
    publicOrigin: new URL(issuer).origin,
    internalOrigin,
    clientId,
    clientSecret,
    redirectUri,
  };
}

/** With no configuration there is no way in: the app cannot let anybody through. */
export function oidcConfigured(): boolean {
  return oidcConfig() !== null;
}



// ─── Discovery ──────────────────────────────────────────────────────
export interface OidcEndpoints {
  authorization: string;
  token: string;
  userinfo: string;
  endSession: string | null;
  jwks: string | null;
  /** Los `iss` que se aceptan: el público y el interno. Ver más abajo. */
  issuers: string[];
}

const DISCOVERY_TTL_MS = 10 * 60 * 1000;
let cache: { key: string; at: number; value: OidcEndpoints } | null = null;

/** Cambia el origen de una URL conservando su ruta: el camino lo elige el
 *  proveedor, la dirección la elegimos nosotros según quién va a llamar. */
function at(endpoint: string, origin: string): string {
  const url = new URL(endpoint);
  const target = new URL(origin);
  url.protocol = target.protocol;
  // `hostname` y `port` POR SEPARADO, nunca `host`: el setter de `host`
  // deja el puerto como estaba si el valor nuevo no trae uno. Con eso,
  // cambiar `http://proveedor-interno:9000/...` al origen público daba
  // `https://auth.publico:9000/...` — el puerto interno colado en la URL a la
  // que se manda el navegador, que desde fuera no existe. Pasó en producción.
  url.hostname = target.hostname;
  url.port = target.port;
  return url.toString();
}

export async function discover(cfg: OidcConfig): Promise<OidcEndpoints> {
  const key = `${cfg.issuer}|${cfg.internalOrigin}`;
  if (cache && cache.key === key && Date.now() - cache.at < DISCOVERY_TTL_MS) return cache.value;

  // Se pregunta por la pata interna: es la misma respuesta y no sale a la red.
  const url = `${at(cfg.issuer, cfg.internalOrigin).replace(/\/+$/, "")}/.well-known/openid-configuration`;
  let doc: Record<string, unknown>;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(OIDC_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`discovery: ${res.status}`);
    doc = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    // Un parpadeo del proveedor no debe tumbar los inicios de sesión mientras
    // se recuerde algo que funcionaba. Si no hay nada recordado, no hay forma
    // de construir las URLs y el error sube.
    if (cache && cache.key === key) return cache.value;
    throw err;
  }

  const need = (name: string): string => {
    const value = doc[name];
    if (typeof value !== "string" || !value) throw new Error(`discovery: sin ${name}`);
    return value;
  };
  const maybe = (name: string): string | null =>
    typeof doc[name] === "string" && doc[name] ? (doc[name] as string) : null;

  const advertised = typeof doc.issuer === "string" ? doc.issuer : cfg.issuer;
  const value: OidcEndpoints = {
    // Al navegador, por la dirección pública; al servidor, por la interna.
    authorization: at(need("authorization_endpoint"), cfg.publicOrigin),
    token: at(need("token_endpoint"), cfg.internalOrigin),
    userinfo: at(need("userinfo_endpoint"), cfg.internalOrigin),
    endSession: maybe("end_session_endpoint")
      ? at(maybe("end_session_endpoint")!, cfg.publicOrigin)
      : null,
    jwks: maybe("jwks_uri") ? at(maybe("jwks_uri")!, cfg.internalOrigin) : null,
    // DOS emisores válidos, y no es laxitud: los tokens que nacen del canje
    // servidor-a-servidor llevan el `iss` INTERNO, porque esa es la dirección
    // por la que se pidieron. Aceptar solo el público rechazaría lo que el
    // propio proveedor manda (visto con el aviso de cierre de sesión).
    issuers: [...new Set([advertised, at(advertised, cfg.publicOrigin), at(advertised, cfg.internalOrigin)])],
  };
  cache = { key, at: Date.now(), value };
  return value;
}

/** Solo para las pruebas: obliga a volver a preguntar. */
export function forgetDiscovery(): void {
  cache = null;
}

export async function authorizeUrl(
  cfg: OidcConfig,
  { state, codeChallenge }: { state: string; codeChallenge: string }
): Promise<string> {
  const url = new URL((await discover(cfg)).authorization);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function endSessionUrl(cfg: OidcConfig): Promise<string | null> {
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
  // Devuelve null si el proveedor no anuncia el endpoint, y ahí quien
  // llama decide (salir de la aplicación y ya).
  return (await discover(cfg)).endSession;
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
  const endpoints = await discover(cfg);
  const res = await fetch(endpoints.token, {
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

  const info = await fetch(endpoints.userinfo, {
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

/**
 * Dónde se manda a quien no tiene cuenta a pedir una.
 *
 * Es propio de cada despliegue, así que llega por entorno. Estaba escrito a fuego
 * en la portada —el flujo de alta de NUESTRO Authentik—, de modo que cualquiera que
 * desplegara este repositorio le ponía a sus visitantes un botón de alta hacia el
 * proveedor de identidad de un desconocido. Con `TABUP_ENROLL_URL` sin fijar no hay
 * botón, que es la misma regla que sigue DocDrop: un proveedor sin alta autoservicio
 * no debe mandar a nadie a una página que lo va a rechazar.
 *
 * No reutiliza `validUrl`: aquélla quita la barra final y rechaza la query, y un
 * flujo de Authentik es exactamente `.../if/flow/<slug>/` —con barra— y puede
 * llevar parámetros.
 */
/**
 * La página de la cuenta en el proveedor: correo, contraseña, segundo factor, sesiones.
 *
 * Nada de eso es de TabUp desde que la identidad está delegada, y hasta ahora la
 * aplicación simplemente callaba: quien quisiera cambiar su contraseña tenía que saberse
 * la dirección del proveedor de memoria. Se enlaza si quien despliega dice dónde está.
 *
 * Por entorno y no deducida del `PUBLIC_BASE`: la ruta es cosa de cada proveedor
 * —Authentik la sirve en `/if/user/`— y este repositorio no se ata a ninguno.
 */
export function accountUrl(): string | null {
  return externalUrl(process.env.TABUP_ACCOUNT_URL);
}

export function enrollUrl(): string | null {
  return externalUrl(process.env.TABUP_ENROLL_URL);
}

/** La regla común a los dos enlaces que salen de la aplicación hacia el proveedor. */
function externalUrl(raw: string | undefined): string | null {
  const valor = raw?.trim();
  if (!valor) return null;

  try {
    const url = new URL(valor);
    // https, porque es un enlace donde alguien va a escribir una contraseña. El
    // loopback en http se admite por lo mismo que en el proveedor: desarrollo.
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
