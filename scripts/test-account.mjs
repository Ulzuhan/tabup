#!/usr/bin/env node
/**
 * Closing an account, and the language a refusal comes back in.
 *
 *   rm -f data/test.db* && TABUP_DB=data/test.db TABUP_REGISTRATION=open npm run start &
 *   npm run test:account
 *
 * Deleting an account is the one action here that reaches other people's screens without
 * them doing anything, so most of this is about what happens to *them*: the group they
 * were in keeps working, it has somebody running it, and the column of figures the person
 * left behind is still there and is not offered to the next stranger through the door.
 *
 * The second half is smaller and duller: every refusal now carries a code, because the
 * app is in Spanish and the sentences were in English.
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
    const type = res.headers.get("content-type") ?? "";
    return {
      status: res.status,
      body: type.includes("json") ? await res.json().catch(() => ({})) : null,
    };
  };
}

const uniq = () => Math.random().toString(36).slice(2, 10);
const PASSWORD = "a long enough password";

async function register(api, name) {
  const email = `${name.toLowerCase()}-${uniq()}@example.com`;
  const res = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name, password: PASSWORD }),
  });
  if (res.status !== 200) {
    console.error(`register failed for ${name}:`, res.status, res.body);
    process.exit(1);
  }
  return email;
}

async function main() {
  const ana = client();
  const anaEmail = await register(ana, "Ana");
  const bea = client();
  const beaEmail = await register(bea, "Bea");
  const caro = client();
  const caroEmail = await register(caro, "Caro");

  // ── What a refusal says ─────────────────────────────────────────────
  console.log("\nUna negativa lleva código");
  const anon = client();
  const refused = await anon("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "X", currency: "EUR", members: [] }),
  });
  check("signing out of a write gives a code", refused.body.code, "signin_required");
  check("and a status", refused.status, 401);
  // The English sentence stays as the developer-facing half: it is what the log records
  // and what curl shows. What must not happen is the *client* having only that.
  check("with the detail still beside it", typeof refused.body.error, "string");

  const badLogin = await anon("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: anaEmail, password: "not it" }),
  });
  check("a wrong password is a code too", badLogin.body.code, "wrong_credentials");

  check(
    "the rate table is not for strangers",
    (await anon("/api/rates")).status,
    401
  );
  check("but it is for anybody signed in", (await ana("/api/rates")).status, 200);

  // ── The trip somebody else is in ────────────────────────────────────
  console.log("\nEl grupo pasa a quien lleva más tiempo");
  const shared = (
    await ana("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Pirineos", currency: "EUR", members: [] }),
    })
  ).body;

  // Bea first, Caro second — so Bea is the one who has been in it longest.
  for (const email of [beaEmail, caroEmail]) {
    await ana(`/api/trips/${shared.id}`, {
      method: "PATCH",
      body: JSON.stringify({ addByEmail: email }),
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  const seats = (await ana(`/api/trips/${shared.id}`)).body;
  const anaSeat = seats.you;
  await ana(`/api/trips/${shared.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Cena", amount: 60, paidBy: anaSeat, category: "food" }),
  });

  // A trip that is hers alone, to show the other half of the rule.
  const alone = (
    await ana("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Solo mía", currency: "EUR", members: [{ name: "Nadie" }] }),
    })
  ).body;

  console.log("\nBorrar la cuenta");
  check(
    "a wrong password does not delete anything",
    (await ana("/api/auth/me", { method: "DELETE", body: JSON.stringify({ password: "nope" }) }))
      .body.code,
    "wrong_credentials"
  );
  check("and she is still signed in", (await ana("/api/auth/me")).body.user?.name, "Ana");

  const deleted = await ana("/api/auth/me", {
    method: "DELETE",
    body: JSON.stringify({ password: PASSWORD }),
  });
  check("with the right one it goes", deleted.status, 200);
  check("one group handed over", deleted.body.handedOver, 1);
  check("one group deleted with her", deleted.body.tripsDeleted, 1);
  check("one seat kept elsewhere", deleted.body.seatsKept, 1);

  check("her session is gone", (await ana("/api/auth/me")).body.user, null);
  check(
    "and the password no longer opens anything",
    (
      await client()("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: anaEmail, password: PASSWORD }),
      })
    ).status,
    401
  );

  // ── What the others see ─────────────────────────────────────────────
  console.log("\nLo que ven los demás");
  const after = await bea(`/api/trips/${shared.id}`);
  check("the group still opens", after.status, 200);
  check("and Bea is running it now", after.body.access, "owner");
  check("Caro can still open it too", (await caro(`/api/trips/${shared.id}`)).status, 200);

  const anaColumn = after.body.members.find((m) => m.name === "Ana");
  check("Ana's column is still there", Boolean(anaColumn), true);
  check("with nobody behind it", anaColumn.userId, null);
  check("the dinner she paid for is still counted", after.body.totalExpenses, 60);

  // The important one. A free name is offered to whoever arrives next; this one must not
  // be, or the next person through the door inherits somebody's money.
  check(
    "her seat is not offered to anybody",
    (await caro(`/api/trips/${shared.id}/claim`)).body.candidates.some((m) => m.name === "Ana"),
    false
  );
  const invite = (await bea(`/api/trips/${shared.id}/invite`, { method: "POST" })).body;
  const stranger = client();
  await register(stranger, "Dani");
  await stranger("/api/join", { method: "POST", body: JSON.stringify({ token: invite.token }) });
  const strangerSees = await stranger(`/api/trips/${shared.id}`);
  check(
    "and a newcomer is seated as themselves instead",
    strangerSees.body.members.find((m) => m.id === strangerSees.body.you)?.name,
    "Dani"
  );
  check("Ana's column is untouched by that", strangerSees.body.totalExpenses, 60);

  check(
    "the group that was hers alone is gone",
    (await bea(`/api/trips/${alone.id}`)).status,
    404
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
