#!/usr/bin/env node
/**
 * The admin panel.
 *
 *   rm -f data/test.db* && TABUP_DB=data/test.db TABUP_REGISTRATION=approval npm run start &
 *   npm run test:admin
 *
 * Needs a database with no accounts in it, because the thing being tested starts with
 * "whoever registers first is the admin". Run against a used one, the first account is
 * somebody else and every assertion below is about the wrong person.
 *
 * What it covers is the part of the app with no email behind it: letting somebody in,
 * handing them a password when they lose theirs, and seeing what has broken.
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
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

/**
 * Bails out clearly when the sign-up throttle has kicked in.
 *
 * The suite creates a handful of accounts per run, and running it several times against
 * the same instance trips the limiter — correctly. Without this the next assertion reads
 * a field off an error body and the whole thing dies with a TypeError, which looks like
 * a broken app rather than a rate limit. Restart against a fresh database, or wait.
 */
function assertNotThrottled(res) {
  if (res.status !== 429) return;
  console.error(
    "\nRegistration is being throttled (429). That is the rate limiter working, not a\n" +
      "failure: this suite creates several accounts per run. Restart the server against a\n" +
      "fresh database and try again."
  );
  process.exit(1);
}

const register = (api, email, name, password) =>
  api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, name, password }) });

async function main() {
  console.log(`Testing against ${BASE}\n`);

  const existing = await fetch(`${BASE}/api/auth/me`).catch(() => null);
  if (!existing?.ok) {
    console.error(`No server at ${BASE}. Start one with: npm run start`);
    process.exit(1);
  }

  // ── Who gets in ─────────────────────────────────────────────────────
  console.log("Approvals");
  const admin = client();
  assertNotThrottled(await register(admin, "admin@example.com", "Admin", "the admin's password"));
  check("the first account is signed straight in", (await admin("/api/auth/me")).body.user?.name, "Admin");

  const ana = client();
  await register(ana, "ana@example.com", "Ana", "ana's own password");
  check("the next one is not", (await ana("/api/auth/me")).body.user, null);
  check("and cannot sign in yet", (
    await client()("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ana@example.com", password: "ana's own password" }),
    })
  ).status, 403);

  const waiting = await admin("/api/admin/users");
  check("the admin sees the request", waiting.body.pending.map((u) => u.email), ["ana@example.com"]);
  check("and is listed as admin", waiting.body.users.find((u) => u.email === "admin@example.com").role, "admin");

  const anaId = waiting.body.pending[0].id;
  check("approving works", (
    await admin("/api/admin/users", { method: "POST", body: JSON.stringify({ id: anaId, action: "approve" }) })
  ).status, 200);
  check("and then she can sign in", (
    await ana("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ana@example.com", password: "ana's own password" }),
    })
  ).status, 200);

  // Rejecting deletes the account, which frees the address for a second try.
  const bea = client();
  await register(bea, "bea@example.com", "Bea", "bea's own password");
  const beaId = (await admin("/api/admin/users")).body.pending[0].id;
  await admin("/api/admin/users", { method: "POST", body: JSON.stringify({ id: beaId, action: "reject" }) });
  check("a rejected request is gone", (await admin("/api/admin/users")).body.pending.length, 0);
  check("and the address is free again", (
    await register(client(), "bea@example.com", "Bea", "another password entirely")
  ).status, 200);

  // ── Passwords, since there is no email ──────────────────────────────
  console.log("\nPasswords");
  check("too short is refused", (
    await admin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ id: anaId, action: "password", password: "short" }),
    })
  ).status, 400);

  check("an unknown account is a 404", (
    await admin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ id: "0".repeat(32), action: "password", password: "a fine new password" }),
    })
  ).status, 404);

  check("the admin sets a new one", (
    await admin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ id: anaId, action: "password", password: "a fine new password" }),
    })
  ).status, 200);
  // Ana was signed in a moment ago; ending that is the point when the reason for the
  // reset is that somebody else got into the account.
  check("which ends her sessions", (await ana("/api/auth/me")).body.user, null);
  check("the old password stops working", (
    await client()("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ana@example.com", password: "ana's own password" }),
    })
  ).status, 401);
  check("and the new one works", (
    await client()("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ana@example.com", password: "a fine new password" }),
    })
  ).status, 200);

  // ── Getting back in without an email ────────────────────────────────
  //
  // The admin hands out a link instead of dictating a password. It is a key to somebody
  // else's account travelling through a chat, so what matters is that it dies quickly
  // and cannot be spent twice.
  console.log("\nRecovery links");
  const anaAgain = client();
  await anaAgain("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ana@example.com", password: "a fine new password" }),
  });

  check("a normal account cannot make one", (
    await anaAgain("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ id: anaId, action: "reset-link" }),
    })
  ).status, 403);

  check("nor for an account that does not exist", (
    await admin("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ id: "0".repeat(32), action: "reset-link" }),
    })
  ).status, 404);

  const link = await admin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ id: anaId, action: "reset-link" }),
  });
  check("the admin makes one", link.status, 200);
  check("for the right account", link.body.email, "ana@example.com");
  check("that lasts about an hour", Math.round((link.body.expiresAt - Date.now()) / 60000), 60);

  const visitor = client();
  const look = await visitor(`/api/auth/reset?token=${encodeURIComponent(link.body.token)}`);
  check("opening it needs no session", look.status, 200);
  check("and it names the account", look.body.email, "ana@example.com");
  check(
    "a made-up token is worth nothing",
    (await visitor("/api/auth/reset?token=nonsense")).body.state,
    "unknown"
  );

  check("a short password is refused", (
    await visitor("/api/auth/reset", {
      method: "POST",
      body: JSON.stringify({ token: link.body.token, password: "short" }),
    })
  ).status, 400);

  const spent = await visitor("/api/auth/reset", {
    method: "POST",
    body: JSON.stringify({ token: link.body.token, password: "the one ana picked" }),
  });
  check("she sets her own password", spent.status, 200);
  check("and is signed in on the spot", (await visitor("/api/auth/me")).body.user?.email, "ana@example.com");
  check("her other sessions were closed", (await anaAgain("/api/auth/me")).body.user, null);
  check("the new password works", (
    await client()("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ana@example.com", password: "the one ana picked" }),
    })
  ).status, 200);

  // The link is in a conversation somewhere and stays there. It has to be worthless now.
  check(
    "the link is spent",
    (await client()(`/api/auth/reset?token=${encodeURIComponent(link.body.token)}`)).body.state,
    "used"
  );
  check("and cannot be used again", (
    await client()("/api/auth/reset", {
      method: "POST",
      body: JSON.stringify({ token: link.body.token, password: "somebody else's idea" }),
    })
  ).body.error, "used");
  check("so the password it set still stands", (
    await client()("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ana@example.com", password: "the one ana picked" }),
    })
  ).status, 200);

  // Asking twice should not leave two keys under the mat.
  const first = await admin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ id: anaId, action: "reset-link" }),
  });
  const second = await admin("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ id: anaId, action: "reset-link" }),
  });
  check(
    "a second link retires the first",
    (await client()(`/api/auth/reset?token=${encodeURIComponent(first.body.token)}`)).body.state,
    "unknown"
  );
  check(
    "and the newest one still works",
    (await client()(`/api/auth/reset?token=${encodeURIComponent(second.body.token)}`)).body.state,
    "ok"
  );

  // ── The error log ───────────────────────────────────────────────────
  console.log("\nError log");
  const before = (await admin("/api/admin/errors")).body.errors.length;

  // A malformed request that reaches a handler and is refused cleanly must not be
  // recorded: the log is for the server breaking, not for people typing nonsense.
  const { body: trip } = await admin("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "T", currency: "EUR", members: [{ name: "A" }, { name: "B" }] }),
  });
  await admin(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "x", amount: 10, paidBy: trip.members[0].id, date: "nope" }),
  });
  check("a rejected request is not an error", (await admin("/api/admin/errors")).body.errors.length, before);

  check("acknowledging all of them works", (
    await admin("/api/admin/errors", { method: "POST", body: JSON.stringify({}) })
  ).status, 200);
  check("and so does clearing", (
    await admin("/api/admin/errors", { method: "POST", body: JSON.stringify({ action: "clear" }) })
  ).body.errors.length, 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
