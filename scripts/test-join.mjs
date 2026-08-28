#!/usr/bin/env node
/**
 * The invitation path, in both kinds of instance.
 *
 *   ./scripts/test-join.sh
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
 */
import { readFileSync, writeFileSync } from "fs";

const BASE = process.env.BASE || "http://127.0.0.1:3117";
const STATE = process.env.STATE || "/tmp/tabup-join-state.json";
const PHASE = process.env.PHASE || "setup";
/** Has to match the one test-join.sh starts the provider phases with. */
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

/** A browser: remembers the session cookie across requests. */
function client() {
  let cookie = "";
  return async (path, options = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(options.headers || {}),
      },
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

/** A stranger loading a page: no cookie, and the HTML rather than JSON. */
async function page(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
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

  const { status, html } = await page(`/join/${token}`);
  check("the invitation page answers", status, 200);
  check("it names the group, so the visitor knows what they were invited to", html.includes(tripName), true);
  // Con cuentas propias el formulario es la puerta buena: una invitación válida es
  // permiso para registrarse en una instancia cerrada. Ese camino no se toca.
  check("with local accounts the form is still there", html.includes('type="password"'), true);
  check("and there is no provider to send anybody to", html.includes("/api/auth/oidc"), false);

  writeFileSync(STATE, JSON.stringify({ token, tripName, seatToken, seatName }));
}

async function provider() {
  const { token, tripName, seatToken, seatName } = JSON.parse(readFileSync(STATE, "utf8"));

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
