#!/usr/bin/env node
/**
 * What changes when identity is delegated to a provider.
 *
 *   ./scripts/test-identity.sh
 *
 * This suite exists because of a bug that nothing else could have caught: the join page
 * always rendered a local email-and-password form and posted it to /api/auth/register —
 * which, with an identity provider configured, answers 404 on purpose. Every other suite
 * runs with the provider switched off (see run-suites.sh, which unsets the variables
 * deliberately), so all of them passed while the deployed app handed everybody it
 * invited the one door that does not exist. Measured afterwards in production: one
 * invitation ever created, nobody ever joined a group.
 *
 * So the assertions here are about the SHAPE OF THE PAGE under each configuration, and
 * the suite runs the same database under two servers to get both. Phases:
 *
 *   setup     no provider: make the account, the group and the invitation, and check the
 *             local form is still offered — that path must keep working, it is what a
 *             clone of this repository runs.
 *   provider  same database, provider configured: no form, a way in through the
 *             provider carrying the invitation, and a way to ask for an account.
 *   noenroll  provider but no TABUP_ENROLL_URL: no sign-up button at all, rather than
 *             one pointing at somebody else's identity provider.
 *
 * The invitation is the loudest case but not the only one: everything that was built for
 * TabUp's own accounts has to either work or step aside when the accounts are somebody
 * else's. The admin panel used to offer approvals and passwords it could no longer act
 * on, and closing your own account asked for a password that, on an account created
 * through the provider, is a filler string no scrypt check will ever accept — so the one
 * thing that screen exists for could not be done at all.
 */
import { readFileSync, writeFileSync } from "fs";

const BASE = process.env.BASE || "http://127.0.0.1:3117";
const STATE = process.env.STATE || "/tmp/tabup-join-state.json";
const PHASE = process.env.PHASE || "setup";
/** Has to match the one test-identity.sh starts the provider phases with. */
const ENROLL = "https://idp.example.invalid/if/flow/enroll-tabup/";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`
  );
  if (ok) passed++;
  else failed++;
}

/**
 * A browser: remembers the session cookie across requests.
 *
 * La cookie queda a la vista porque las sesiones viven en la base de datos, y la base
 * sobrevive al cambio de servidor entre fases: es la única forma de llegar a la fase
 * del proveedor con una sesión de administrador, que allí no se puede abrir.
 */
function client(initial = "") {
  const jar = { cookie: initial };
  const call = async (path, options = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(jar.cookie ? { cookie: jar.cookie } : {}),
        ...(options.headers || {}),
      },
    });
    const sc = res.headers.get("set-cookie");
    if (sc) jar.cookie = sc.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  call.jar = jar;
  return call;
}

/**
 * Somebody loading a page: the HTML rather than JSON.
 *
 * Sin cookie salvo que se le dé una — casi todo lo que se mira aquí es lo que ve
 * quien llega de fuera con un enlace.
 */
async function page(path, cookie = "") {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return {
    status: res.status,
    headers: { location: res.headers.get("location") },
    html: await res.text(),
  };
}

const uniq = () => Math.random().toString(36).slice(2, 10);

/** Where signing in has to lead from an invitation: the provider, and back to it. */
const oidcLink = (token) => `/api/auth/oidc?next=${encodeURIComponent(`/join/${token}`)}`;

async function setup() {
  const owner = client();
  const email = `anfitriona-${uniq()}@example.com`;

  const registered = await owner("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name: "Anfitriona", password: "contrasena-larga" }),
  });
  check("the owner gets an account (no provider configured)", registered.status, 200);

  const tripName = `Cena de prueba ${uniq()}`;
  const trip = await owner("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: tripName, currency: "EUR", members: [] }),
  });
  check("and a group", trip.status, 200);

  const invite = await owner(`/api/trips/${trip.body.id}/invite`, { method: "POST" });
  check("and an invitation to it", invite.status, 200);

  const token = invite.body.token;

  // Invitar por correo es el otro camino, y el que más se usa: crea el sitio y ata el
  // enlace a él, así que la página tiene que decir de quién es el sitio que espera.
  const guestEmail = `carla-${uniq()}@example.com`;
  const seated = await owner(`/api/trips/${trip.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: guestEmail }),
  });
  check("adding somebody by email seats them and makes their link", seated.status, 200);
  const seatToken = seated.body.invite.token;
  const seatName = guestEmail.split("@")[0];

  // Quien registra primero es el administrador de la instancia.
  const panel = await owner("/api/admin/users");
  check("the first account administers this instance", panel.status, 200);

  // Una cuenta de usar y tirar: la fase del proveedor comprueba que cerrarla es
  // posible allí, y borrarla no puede llevarse por delante el grupo de arriba.
  const doomed = client();
  const doomedEmail = `sobra-${uniq()}@example.com`;
  const madeDoomed = await doomed("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: doomedEmail, name: "De paso", password: "contrasena-larga" }),
  });
  check("and a second account exists to be closed later", madeDoomed.status, 200);

  const { status, html } = await page(`/join/${token}`);
  check("the invitation page answers", status, 200);
  check("it names the group, so the visitor knows what they were invited to", html.includes(tripName), true);
  // Con cuentas propias el formulario es la puerta buena: una invitación válida es
  // permiso para registrarse en una instancia cerrada. Ese camino no se toca.
  check("with local accounts the form is still there", html.includes('type="password"'), true);
  check("and there is no provider to send anybody to", html.includes("/api/auth/oidc"), false);

  writeFileSync(
    STATE,
    JSON.stringify({
      token,
      tripName,
      seatToken,
      seatName,
      adminCookie: owner.jar.cookie,
      doomedCookie: doomed.jar.cookie,
      doomedEmail,
    })
  );
}

async function provider() {
  const { token, tripName, seatToken, seatName, adminCookie, doomedCookie, doomedEmail } =
    JSON.parse(readFileSync(STATE, "utf8"));

  const { status, html } = await page(`/join/${token}`);
  check("the invitation page answers", status, 200);
  check("it still names the group", html.includes(tripName), true);

  // El fallo, en una línea: el formulario que no podía funcionar.
  check("no password form when the accounts are the provider's", html.includes('type="password"'), false);
  check("it offers the provider, carrying the invitation back", html.includes(oidcLink(token)), true);

  // El enlace hecho para una persona dice de quién es el sitio, con las dos
  // sustituciones —grupo y nombre— hechas en el servidor.
  const seat = await page(`/join/${seatToken}`);
  check("a link made for one person names their seat", seat.html.includes(seatName), true);
  check("and still names the group", seat.html.includes(tripName), true);
  check("with no placeholder left behind", /\{(trip|name)\}/.test(seat.html), false);
  check("and where to ask for an account", html.includes(ENROLL), true);

  // Y por qué ese formulario era un callejón sin salida, comprobado de frente.
  const stranger = client();
  const registering = await stranger("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `alguien-${uniq()}@example.com`,
      name: "Alguien",
      password: "contrasena-larga",
      inviteToken: token,
    }),
  });
  check("registering locally is 404 with a provider — what the old form posted into", registering.status, 404);

  const redeeming = await stranger("/api/join", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  check("and redeeming without a session is refused", redeeming.status, 401);

  // Un token inventado no cuenta nada de ningún grupo.
  const unknown = await page(`/join/${uniq()}${uniq()}`);
  check("an unknown token gets the expired page", unknown.status, 200);
  check("which names no group", unknown.html.includes(tripName), false);
  check("and offers no way in", unknown.html.includes("/api/auth/oidc"), false);

  // ── El panel de administración ────────────────────────────────────
  // La sesión es la misma de la fase anterior: la sesión vive en la base y la base no
  // ha cambiado. Aquí no se podría abrir una, que es justo el sentido de delegar.
  const admin = client(adminCookie);
  check("the admin is still signed in across the change", (await admin("/api/auth/me")).body.user.admin, true);
  check("but the accounts list is the provider's business now", (await admin("/api/admin/users")).status, 403);
  check(
    "and so is approving anybody",
    (await admin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ id: "cualquiera", action: "approve" }),
    })).status,
    403
  );
  // Lo que sí queda: los fallos del servidor, que no son de nadie más.
  check("the error log stays, which is what the panel is for now", (await admin("/api/admin/errors")).status, 200);
  // Sin cookie de administrador la página no existe, y eso no cambia: se pide con la
  // sesión puesta, que es lo que se está comprobando que sigue sirviendo para algo.
  check("and the page still opens for the admin", (await page("/admin", adminCookie)).status, 200);

  // ── Cerrar la propia cuenta ───────────────────────────────────────
  const doomed = client(doomedCookie);
  check(
    "closing an account no longer takes a password — there is none to check",
    (await doomed("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ password: "contrasena-larga" }),
    })).status,
    403
  );
  check(
    "nor somebody else's address",
    (await doomed("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ confirm: "otra@example.com" }),
    })).status,
    403
  );
  check(
    "typing your own address closes it",
    (await doomed("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ confirm: doomedEmail.toUpperCase() }),
    })).status,
    200
  );
  check("and the session goes with it", (await doomed("/api/auth/me")).body.user, null);

  // ── Recuperar contraseña ──────────────────────────────────────────
  const reset = await page("/reset/loquesea");
  check("the password-reset screen sends people to the provider", reset.status, 307);
  check("which is what /login knows how to do", reset.headers.location, "/login");

  // La portada, por el mismo motivo: la dirección del alta la pone quien despliega.
  const landing = await page("/");
  check("the landing points at the configured provider", landing.html.includes(ENROLL), true);
  check(
    "and at nobody else's — this used to be a constant in the source",
    landing.html.includes("auth.kaicorplabs.com"),
    false
  );
}

async function noenroll() {
  const { token } = JSON.parse(readFileSync(STATE, "utf8"));

  const join = await page(`/join/${token}`);
  check("signing in through the provider is still offered", join.html.includes(oidcLink(token)), true);
  check("but no sign-up button when the deployment publishes none", join.html.includes(ENROLL), false);

  const landing = await page("/");
  check("nor on the landing", landing.html.includes(ENROLL), false);
  check("and still nothing hardcoded", landing.html.includes("auth.kaicorplabs.com"), false);
}

const PHASES = { setup, provider, noenroll };

async function main() {
  const run = PHASES[PHASE];
  if (!run) {
    console.error(`unknown phase: ${PHASE}`);
    process.exit(1);
  }
  await run();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
