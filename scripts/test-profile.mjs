#!/usr/bin/env node
/**
 * El perfil: lo que una persona trae puesto a cada grupo.
 *
 *   TABUP_REGISTRATION=open npm run start &
 *   npm run test:profile
 *
 * Hasta ahora lo único ajustable era el alias dentro de un grupo, así que todo lo que se
 * comprueba aquí —el nombre con el que entras, tu cara, la moneda con la que abres un
 * grupo, cómo te pagan y de qué te enteras— o no existía o lo decidía el orden de
 * llegada. Lo que importa de cada cosa no es que se guarde, sino **dónde se nota**: por
 * eso casi ninguna aserción mira el perfil, sino el grupo que se crea después.
 */
const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;

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

function client() {
  const jar = { cookie: "" };
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
    const type = res.headers.get("content-type") ?? "";
    return {
      status: res.status,
      body: type.includes("json") ? await res.json().catch(() => ({})) : null,
    };
  };
  call.jar = jar;
  return call;
}

const uniq = () => Math.random().toString(36).slice(2, 10);

async function register(api, name) {
  const email = `${name.toLowerCase()}-${uniq()}@example.com`;
  const res = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name, password: "a long enough password" }),
  });
  if (res.status !== 200) {
    console.error(`register failed for ${name}:`, res.status, res.body);
    process.exit(1);
  }
  return email;
}

const perfil = (api, parche) => api("/api/auth/me", { method: "PATCH", body: JSON.stringify(parche) });

async function main() {
  console.log(`Testing against ${BASE}\n`);

  const ana = client();
  const anaEmail = await register(ana, "Ana");

  // ── Lo que se puede cambiar, y lo que no se acepta ──────────────────
  console.log("Lo tuyo");
  check("it starts with the name the account was made with", (await ana("/api/auth/me")).body.user.name, "Ana");

  check("the name can be changed", (await perfil(ana, { name: "Anita" })).status, 200);
  check("and it is what the session says afterwards", (await ana("/api/auth/me")).body.user.name, "Anita");
  check("an empty name is refused", (await perfil(ana, { name: "   " })).body.code, "name_length");
  check("and so is a novel", (await perfil(ana, { name: "x".repeat(81) })).body.code, "name_length");

  check("an emoji off the list is refused", (await perfil(ana, { emoji: "🚀🚀" })).body.code, "invalid_emoji");
  check("one from the list is kept", (await perfil(ana, { emoji: "🦊" })).body.user.emoji, "🦊");
  // Null es una respuesta válida: «la que toque».
  check("and it can be given back", (await perfil(ana, { emoji: null })).body.user.emoji, null);

  check("a currency that does not exist is refused", (await perfil(ana, { defaultCurrency: "XXX" })).body.code, "invalid_currency");
  check("one that does is kept", (await perfil(ana, { defaultCurrency: "PHP" })).body.user.defaultCurrency, "PHP");

  check("payment details longer than the field are refused", (await perfil(ana, { payTo: "x".repeat(141) })).body.code, "pay_to_long");
  check("a normal one is kept", (await perfil(ana, { payTo: " Bizum 600000000 " })).body.user.payTo, "Bizum 600000000");
  check("and emptying it means publishing nothing", (await perfil(ana, { payTo: "" })).body.user.payTo, null);

  // Lo que no se manda, no se toca: es lo que permite guardar una sección sola.
  await perfil(ana, { payTo: "Bizum 600000000" });
  const soloNombre = await perfil(ana, { name: "Ana" });
  check("a patch touches only what it carries", soloNombre.body.user.payTo, "Bizum 600000000");

  check("nobody edits a profile without a session", (await client()("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ name: "Nadie" }),
  })).status, 401);

  // ── Dónde se nota: el grupo que se crea después ─────────────────────
  console.log("\nLo que se trae puesto a un grupo");
  await perfil(ana, { emoji: "🦊" });
  const grupo = (await ana("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Con perfil", currency: "PHP", members: [] }),
  })).body;
  check("the owner's seat wears the face they chose", grupo.members[0].emoji, "🦊");

  // Y quien llega después, también — salvo que esa cara ya esté cogida en ese grupo.
  const bea = client();
  const beaEmail = await register(bea, "Bea");
  await perfil(bea, { emoji: "🦊" });
  await ana(`/api/trips/${grupo.id}`, { method: "PATCH", body: JSON.stringify({ addByEmail: beaEmail }) });
  const conBea = (await ana(`/api/trips/${grupo.id}`)).body;
  const asientoBea = conBea.members.find((m) => m.name !== "Ana");
  check("somebody joining brings their own face", Boolean(asientoBea), true);
  check("but not one already taken in that group", asientoBea.emoji === "🦊", false);

  // ── Cómo te pagan: quién lo ve ──────────────────────────────────────
  console.log("\nCómo te pagan");
  await perfil(bea, { payTo: "Bizum 611111111" });
  const asiento = asientoBea.id;
  check(
    "somebody in the group sees how to pay them",
    (await ana(`/api/trips/${grupo.id}/pay-to?member=${asiento}`)).body.payTo,
    "Bizum 611111111"
  );
  const caro = client();
  await register(caro, "Caro");
  check(
    "a stranger gets the same 404 as for anything else in the group",
    (await caro(`/api/trips/${grupo.id}/pay-to?member=${asiento}`)).status,
    404
  );
  // Un nombre a secas no tiene cuenta detrás, así que no hay nada que enseñar — y eso
  // es distinto de que exista y esté vacío, pero para quien pregunta significa lo mismo.
  const conNombre = await ana(`/api/trips/${grupo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addMembers: ["Carla"] }),
  });
  const libre = conNombre.body.members.find((m) => m.name === "Carla");
  check(
    "a bare name has nothing to show",
    (await ana(`/api/trips/${grupo.id}/pay-to?member=${libre.id}`)).body.payTo,
    null
  );

  // ── Llevarse lo suyo ────────────────────────────────────────────────
  console.log("\nTus datos");
  await ana("/api/recurring", {
    method: "POST",
    body: JSON.stringify({ name: "Alquiler", amount: 780, currency: "EUR", period: "monthly", startedAt: "2025-01-01" }),
  });
  check("no session, no export", (await client()("/api/account/export")).status, 401);

  const conSesion = await ana("/api/account/export");
  check("the export answers", conSesion.status, 200);

  const datos = conSesion.body;
  const crudo = JSON.stringify(datos);
  check("it carries the account", datos.account.email, anaEmail);
  check("its groups", datos.trips.length >= 1, true);
  check("with their expenses inside", Array.isArray(datos.trips[0].expenses), true);
  check("and the fixed costs, which belong to no group", datos.recurring.length, 1);
  check("never the password hash", crudo.includes("scrypt$"), false);
  check("nor anybody's session", crudo.includes("token_hash"), false);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
