#!/usr/bin/env node
/**
 * Integration tests for accounts, ownership and sharing.
 *
 *   TABUP_ALLOW_REGISTRATION=true npm run start &
 *   npm run test:auth
 *
 * Registration is closed by default once an instance has its first account, so the
 * suite needs it opened explicitly — it creates several accounts on purpose.
 *
 * The point of these is the isolation boundary: an owned trip must be invisible and
 * unwritable to everyone who was not given access, including someone who knows its id.
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

/** A browser: remembers the session cookie across requests, like a real client. */
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

const uniq = () => Math.random().toString(36).slice(2, 10);

const newTrip = (api, name = "Trip") =>
  api("/api/trips", {
    method: "POST",
    body: JSON.stringify({
      name,
      currency: "EUR",
      members: [{ name: "Ana" }, { name: "Bea" }],
    }),
  });

async function main() {
  console.log(`Testing against ${BASE}\n`);

  const health = await fetch(`${BASE}/api/auth/me`).catch(() => null);
  if (!health?.ok) {
    console.error(`No server at ${BASE}. Start one with: npm run start`);
    process.exit(1);
  }

  // ── Registration and sessions ──────────────────────────────────────
  console.log("Registration and sessions");
  const alice = client();
  const aliceEmail = `alice-${uniq()}@example.com`;

  const weak = await alice("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: aliceEmail, name: "Alice", password: "short" }),
  });
  check("short password is rejected", weak.status, 400);

  const badEmail = await alice("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "not-an-email", name: "Alice", password: "correct horse battery" }),
  });
  check("invalid email is rejected", badEmail.status, 400);

  const reg = await alice("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: aliceEmail, name: "Alice", password: "correct horse battery" }),
  });
  check("registration succeeds", reg.status, 200);
  check("session is live", (await alice("/api/auth/me")).body.user?.email, aliceEmail);

  const dup = await client()("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: aliceEmail, name: "Impostor", password: "another password" }),
  });
  check("duplicate email is rejected", dup.status, 409);

  const anonymous = client();
  check("anonymous has no user", (await anonymous("/api/auth/me")).body.user, null);

  // ── Ownership ──────────────────────────────────────────────────────
  console.log("\nOwnership");
  const { body: aliceTrip } = await newTrip(alice, "Alice's trip");
  check("owner sees it listed", (await alice("/api/trips")).body.trips.length, 1);
  check("anonymous listing is empty", (await anonymous("/api/trips")).body.trips.length, 0);

  const peek = await anonymous(`/api/trips/${aliceTrip.id}`);
  check("stranger knowing the id gets 404", peek.status, 404);

  const write = await anonymous(`/api/trips/${aliceTrip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Not mine",
      amount: 10,
      paidBy: aliceTrip.members[0].id,
      category: "food",
    }),
  });
  check("stranger cannot write", write.status, 404);

  const exported = await fetch(`${BASE}/api/trips/${aliceTrip.id}/export`);
  check("stranger cannot export", exported.status, 404);

  const stealDelete = await anonymous(`/api/trips/${aliceTrip.id}`, { method: "DELETE" });
  check("stranger cannot delete", stealDelete.status, 404);
  check("trip survived", (await alice(`/api/trips/${aliceTrip.id}`)).status, 200);

  // ── Anonymous trips still work ─────────────────────────────────────
  console.log("\nAnonymous trips");
  const { body: openTrip } = await newTrip(anonymous, "Open trip");
  check("anyone with the link can read", (await client()(`/api/trips/${openTrip.id}`)).status, 200);

  const openWrite = await client()(`/api/trips/${openTrip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Beers",
      amount: 12,
      paidBy: openTrip.members[0].id,
      category: "food",
    }),
  });
  check("anyone with the link can write", openWrite.status, 200);

  // ── Claiming ───────────────────────────────────────────────────────
  console.log("\nClaiming");
  const claim = await alice(`/api/trips/${openTrip.id}/claim`, { method: "POST" });
  check("signed-in user claims it", claim.status, 200);
  check("now closed to strangers", (await client()(`/api/trips/${openTrip.id}`)).status, 404);

  const reclaim = await client()(`/api/trips/${openTrip.id}/claim`, { method: "POST" });
  check("claiming without an account fails", reclaim.status, 401);

  const bob = client();
  const bobEmail = `bob-${uniq()}@example.com`;
  await bob("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: bobEmail, name: "Bob", password: "another good password" }),
  });
  const steal = await bob(`/api/trips/${openTrip.id}/claim`, { method: "POST" });
  check("an owned trip cannot be claimed", steal.status, 409);

  // ── Sharing ────────────────────────────────────────────────────────
  console.log("\nSharing");
  const shareUnknown = await alice(`/api/trips/${aliceTrip.id}/share`, {
    method: "POST",
    body: JSON.stringify({ email: "nobody@example.com" }),
  });
  check("sharing with an unknown email fails", shareUnknown.status, 404);

  const shared = await alice(`/api/trips/${aliceTrip.id}/share`, {
    method: "POST",
    body: JSON.stringify({ email: bobEmail, role: "editor" }),
  });
  check("sharing succeeds", shared.status, 200);
  check("both are listed", shared.body.collaborators.length, 2);
  check("collaborator can now read", (await bob(`/api/trips/${aliceTrip.id}`)).status, 200);
  // Bob owns nothing of his own, so the shared trip is his whole list.
  const bobList = (await bob("/api/trips")).body.trips;
  check("and it shows in their list", bobList.length, 1);
  check("marked as not theirs", bobList[0].owned, false);

  const bobExpense = await bob(`/api/trips/${aliceTrip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Bob pays",
      amount: 30,
      paidBy: aliceTrip.members[0].id,
      category: "food",
    }),
  });
  check("editor can write", bobExpense.status, 200);

  const bobDelete = await bob(`/api/trips/${aliceTrip.id}`, { method: "DELETE" });
  check("editor cannot delete the trip", bobDelete.status, 403);

  const bobShares = await bob(`/api/trips/${aliceTrip.id}/share`, {
    method: "POST",
    body: JSON.stringify({ email: aliceEmail }),
  });
  check("editor cannot reshare", bobShares.status, 403);

  // ── Read-only role ─────────────────────────────────────────────────
  console.log("\nRead-only role");
  await alice(`/api/trips/${aliceTrip.id}/share`, {
    method: "POST",
    body: JSON.stringify({ email: bobEmail, role: "viewer" }),
  });
  check("viewer can still read", (await bob(`/api/trips/${aliceTrip.id}`)).status, 200);

  const viewerWrite = await bob(`/api/trips/${aliceTrip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Nope",
      amount: 5,
      paidBy: aliceTrip.members[0].id,
      category: "food",
    }),
  });
  check("viewer cannot write", viewerWrite.status, 403);

  const revoked = await alice(`/api/trips/${aliceTrip.id}/share`, {
    method: "DELETE",
    body: JSON.stringify({ userId: shared.body.collaborators.find((c) => c.email === bobEmail).id }),
  });
  check("access is revoked", revoked.status, 200);
  check("and they lose sight of it", (await bob(`/api/trips/${aliceTrip.id}`)).status, 404);

  // ── Login and logout ───────────────────────────────────────────────
  console.log("\nLogin and logout");
  await alice("/api/auth/logout", { method: "POST" });
  check("logout ends the session", (await alice("/api/auth/me")).body.user, null);
  check("and the trip is out of reach", (await alice(`/api/trips/${aliceTrip.id}`)).status, 404);

  const wrongPassword = await alice("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: aliceEmail, password: "not the password" }),
  });
  check("wrong password is rejected", wrongPassword.status, 401);

  const back = await alice("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: aliceEmail, password: "correct horse battery" }),
  });
  check("login works", back.status, 200);
  check("email is case-insensitive", back.body.user.email, aliceEmail.toLowerCase());
  check("trips are back", (await alice(`/api/trips/${aliceTrip.id}`)).status, 200);

  // ── No cap on owning trips ─────────────────────────────────────────
  // There used to be a hard limit of three. It saved nothing worth saving and was the
  // same invented scarcity people resent elsewhere, so it is off unless
  // TABUP_FREE_TRIP_LIMIT asks for it.
  console.log("\nNo trip cap");
  const carol = client();
  await carol("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `carol-${uniq()}@example.com`,
      name: "Carol",
      password: "yet another password",
    }),
  });
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await newTrip(carol, `Trip ${i}`)).status);
  check("owning trips is not capped", statuses, [200, 200, 200, 200, 200]);

  const { body: usage } = await carol("/api/auth/me");
  check("and no limit is advertised", usage.usage.tripLimit, null);

  const anonAgain = await newTrip(client(), "Still free");
  check("anonymous creation works too", anonAgain.status, 200);

  // ── Cleanup ────────────────────────────────────────────────────────
  await alice(`/api/trips/${aliceTrip.id}`, { method: "DELETE" });
  await alice(`/api/trips/${openTrip.id}`, { method: "DELETE" });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
