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
  assertNotThrottled(reg);
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
  check("listing without an account is refused", (await anonymous("/api/trips")).status, 401);

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

  // ── An account is required, always ─────────────────────────────────
  console.log("\nNo anonymous mode");
  const anonCreate = await newTrip(anonymous, "Should not exist");
  check("creating without an account is refused", anonCreate.status, 401);

  const bob = client();
  const bobEmail = `bob-${uniq()}@example.com`;
  await bob("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: bobEmail, name: "Bob", password: "another good password" }),
  });

  // ── Bringing somebody into a trip ──────────────────────────────────
  // One act, not two: an address seats them in the split *and* lets them in. It used to
  // be possible to have one without the other, which is how somebody could run a trip
  // while appearing in nobody's balance.
  console.log("\nBringing somebody in");
  const addUnknown = await alice(`/api/trips/${aliceTrip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: `nobody-${uniq()}@example.com` }),
  });
  check("an address nobody holds still gets a seat", addUnknown.status, 200);
  check("and an invitation to send them", typeof addUnknown.body.invite?.token, "string");

  const added = await alice(`/api/trips/${aliceTrip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: bobEmail }),
  });
  check("adding an account succeeds", added.status, 200);
  check(
    "and seats them in the split",
    added.body.members.some((m) => m.accountName === "Bob"),
    true
  );
  check("they can now read it", (await bob(`/api/trips/${aliceTrip.id}`)).status, 200);

  const bobView = await bob(`/api/trips/${aliceTrip.id}`);
  check("and are one of the people in it", typeof bobView.body.you, "string");
  check("with nothing to claim", bobView.body.unclaimed.length, 0);
  check("seen as a member, not the owner", bobView.body.access, "member");
  check("emails stay with the owner", bobView.body.members.some((m) => m.accountEmail), false);

  const bobMemberId = bobView.body.you;

  // Bob owns nothing of his own, so the shared trip is his whole list.
  const bobList = (await bob("/api/trips")).body.trips;
  check("it shows in their list", bobList.length, 1);
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
  check("everyone in a trip can add an expense", bobExpense.status, 200);

  // ── The trip itself is the owner's ─────────────────────────────────
  console.log("\nThe trip belongs to whoever made it");
  check(
    "somebody in it cannot delete it",
    (await bob(`/api/trips/${aliceTrip.id}`, { method: "DELETE" })).status,
    403
  );
  check(
    "nor rename it",
    (
      await bob(`/api/trips/${aliceTrip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Bob's now" }),
      })
    ).status,
    403
  );
  check(
    "nor set a budget",
    (
      await bob(`/api/trips/${aliceTrip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ budget: 500 }),
      })
    ).status,
    403
  );
  check(
    "nor bring anybody else in",
    (
      await bob(`/api/trips/${aliceTrip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ addByEmail: aliceEmail }),
      })
    ).status,
    403
  );
  check(
    "nor add a name by hand",
    (
      await bob(`/api/trips/${aliceTrip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ addMembers: ["Ghost"] }),
      })
    ).status,
    403
  );
  check(
    "nor take anybody out",
    (
      await bob(`/api/trips/${aliceTrip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ removeMembers: [aliceTrip.members[1].id] }),
      })
    ).status,
    403
  );
  check(
    "nor invite by link",
    (await bob(`/api/trips/${aliceTrip.id}/invite`, { method: "POST" })).status,
    403
  );

  // ── Each answers for what they entered ─────────────────────────────
  console.log("\nYour expenses are yours");
  const aliceExpense = await alice(`/api/trips/${aliceTrip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Alice pays",
      amount: 12,
      paidBy: aliceTrip.members[0].id,
      category: "food",
    }),
  });
  check("the owner adds one too", aliceExpense.status, 200);

  const bobEditsAlices = await bob(`/api/trips/${aliceTrip.id}/expense`, {
    method: "PATCH",
    body: JSON.stringify({ expenseId: aliceExpense.body.id, description: "Mine now" }),
  });
  check("somebody else's expense is not theirs to edit", bobEditsAlices.status, 403);
  check(
    "nor to delete",
    (
      await bob(`/api/trips/${aliceTrip.id}/expense`, {
        method: "DELETE",
        body: JSON.stringify({ expenseId: aliceExpense.body.id }),
      })
    ).status,
    403
  );
  check(
    "their own is",
    (
      await bob(`/api/trips/${aliceTrip.id}/expense`, {
        method: "PATCH",
        body: JSON.stringify({ expenseId: bobExpense.body.id, description: "Bob pays, edited" }),
      })
    ).status,
    200
  );
  check(
    "and the owner can fix anybody's",
    (
      await alice(`/api/trips/${aliceTrip.id}/expense`, {
        method: "PATCH",
        body: JSON.stringify({ expenseId: bobExpense.body.id, description: "Tidied up" }),
      })
    ).status,
    200
  );

  const marked = await bob(`/api/trips/${aliceTrip.id}`);
  check(
    "the trip says which are theirs",
    marked.body.expenses.find((e) => e.id === bobExpense.body.id).mine,
    true
  );
  check(
    "and which are not",
    marked.body.expenses.find((e) => e.id === aliceExpense.body.id).mine,
    false
  );
  check(
    "the owner is told they may touch all of them",
    (await alice(`/api/trips/${aliceTrip.id}`)).body.expenses.every((e) => e.mine),
    true
  );

  // ── Leaving a trip keeps the money ─────────────────────────────────
  // Removing somebody with an account is not a statement that their half of the taxi
  // never happened: they lose their access, their column and its figures stay.
  console.log("\nTaking somebody out");
  const released = await alice(`/api/trips/${aliceTrip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: [bobMemberId] }),
  });
  check("the owner takes them out", released.status, 200);
  check("they lose sight of it", (await bob(`/api/trips/${aliceTrip.id}`)).status, 404);

  const afterRelease = await alice(`/api/trips/${aliceTrip.id}`);
  const bobSeat = afterRelease.body.members.find((m) => m.id === bobMemberId);
  check("their seat stays", Boolean(bobSeat), true);
  // Still theirs, marked as out. Unlinking it would turn a person's column of money into
  // a free name for the next stranger with a link to claim, and would give them a second
  // empty column if they were ever invited back.
  check("still tied to their account", Boolean(bobSeat.userId), true);
  check("and marked as no longer in the trip", bobSeat.inTrip, false);
  check(
    "and their expense is still counted",
    afterRelease.body.expenses.some((e) => e.id === bobExpense.body.id),
    true
  );
  check(
    "nobody else is offered it",
    (await alice(`/api/trips/${aliceTrip.id}/claim`)).body.candidates.some(
      (m) => m.id === bobMemberId
    ),
    false
  );

  const ownerSeat = afterRelease.body.members.find((m) => m.name === "Alice");
  check(
    "a trip cannot be left without its owner",
    (
      await alice(`/api/trips/${aliceTrip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ removeMembers: [ownerSeat.id] }),
      })
    ).status,
    400
  );

  // Inviting them back returns them to the column that already holds their money.
  const backIn = await alice(`/api/trips/${aliceTrip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: bobEmail }),
  });
  check("inviting them back works", backIn.status, 200);
  check(
    "into the same column, not a second one",
    backIn.body.members.filter((m) => m.userId === bobSeat.userId).map((m) => m.id),
    [bobMemberId]
  );
  check("marked as in the trip again", backIn.body.members.find((m) => m.id === bobMemberId).inTrip, true);
  check("and they can open it again", (await bob(`/api/trips/${aliceTrip.id}`)).status, 200);

  // ── Invitations ────────────────────────────────────────────────────
  console.log("\nInvitations");
  const { body: inviteTrip } = await newTrip(alice, "Invited trip");
  const invite = await alice(`/api/trips/${inviteTrip.id}/invite`, { method: "POST" });
  check("owner creates an invitation", invite.status, 200);

  const guest = client();
  check("stranger cannot see the trip", (await guest(`/api/trips/${inviteTrip.id}`)).status, 404);

  const lookup = await guest(`/api/join?token=${encodeURIComponent(invite.body.token)}`);
  check("the invitation names the trip", lookup.body.tripName, "Invited trip");

  // A valid invitation is permission to register even when sign-ups are closed.
  const joined = await guest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `guest-${uniq()}@example.com`,
      name: "Guest",
      password: "a guest password",
      inviteToken: invite.body.token,
    }),
  });
  check("invited guest registers", joined.status, 200);
  check("and lands in the trip", joined.body.tripId, inviteTrip.id);
  check("who can now read it", (await guest(`/api/trips/${inviteTrip.id}`)).status, 200);

  // The suite runs with sign-ups open, so a bogus token cannot be tested as a
  // registration wall here — what it must not do is grant access to anything.
  const badToken = await client()("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `nobody-${uniq()}@example.com`,
      name: "Nobody",
      password: "another password",
      inviteToken: "made-up-token",
    }),
  });
  check("a made-up token joins nothing", badToken.body.tripId ?? null, null);

  const guestInvite = await guest(`/api/trips/${inviteTrip.id}/invite`, { method: "POST" });
  check("somebody in a trip cannot invite others", guestInvite.status, 403);

  // ── An invitation puts you in the split ────────────────────────────
  // The whole point of the change: accepting used to grant access and nothing else, so
  // the person who accepted could run a trip they appeared in nobody's balance in.
  //
  // Which of the two things happens depends on whether the trip still holds names
  // somebody typed before they arrived — one of those may be them, and that is a guess
  // about money, so it is asked rather than assumed.
  console.log("\nAn invitation puts you in the split");
  const guestView = await guest(`/api/trips/${inviteTrip.id}`);
  check("a trip with free names asks which one they are", guestView.body.you, null);
  check("and offers exactly those", guestView.body.unclaimed.length, 2);

  const guestClaim = await guest(`/api/trips/${inviteTrip.id}/claim`, {
    method: "POST",
    body: JSON.stringify({ create: true, name: "Guest in Rome" }),
  });
  check("they can join as themselves instead", guestClaim.status, 200);
  check("under the name they chose", guestClaim.body.member.name, "Guest in Rome");
  check(
    "and the question stops being asked",
    (await guest(`/api/trips/${inviteTrip.id}`)).body.unclaimed.length,
    0
  );

  const soloTrip = await alice("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Nobody typed in", currency: "EUR", members: [] }),
  });
  check("a trip can start with only its owner", soloTrip.status, 200);

  const soloLink = await alice(`/api/trips/${soloTrip.body.id}/invite`, { method: "POST" });
  const newcomer = client();
  const newcomerJoin = await newcomer("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `newcomer-${uniq()}@example.com`,
      name: "Newcomer",
      password: "a newcomer password",
      inviteToken: soloLink.body.token,
    }),
  });
  check("somebody joins it by link", newcomerJoin.status, 200);

  const newcomerView = await newcomer(`/api/trips/${soloTrip.body.id}`);
  check("with nothing free to claim they are seated on the way in", typeof newcomerView.body.you, "string");
  check("so there is nothing to ask", newcomerView.body.unclaimed.length, 0);
  check(
    "under their account's name",
    newcomerView.body.members.find((m) => m.id === newcomerView.body.you).name,
    "Newcomer"
  );
  check(
    "and they can add expenses straight away",
    (
      await newcomer(`/api/trips/${soloTrip.body.id}/expense`, {
        method: "POST",
        body: JSON.stringify({
          description: "First round",
          amount: 10,
          paidBy: newcomerView.body.you,
          category: "food",
        }),
      })
    ).status,
    200
  );

  // ── /api/admin is closed to normal accounts ────────────────────────
  // Whoever registered first on this instance is the admin; Bob was not, so these hold
  // however the database got into its current state. The admin's own side of the panel
  // needs a known-first account and lives in test-admin.mjs.
  console.log("\nAdmin is not for everyone");
  check("a normal account cannot list the accounts", (await bob("/api/admin/users")).status, 403);
  check("nor read the error log", (await bob("/api/admin/errors")).status, 403);
  check("nor set anybody's password", (
    await bob("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ id: "whoever", action: "password", password: "let me in please" }),
    })
  ).status, 403);

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



  // ── Machacar una cuenta no puede cerrar la puerta a las demás ───────
  //
  // El contador por dirección tenía delante un proxy, así que la dirección era
  // siempre la suya: todo el mundo compartía contador. Diez fallos de cualquiera
  // y la instancia entera quedaba cerrada quince minutos, sin salida, porque el
  // contador se limpia al acertar y acertar era justo lo bloqueado. Comprobado
  // entonces: doce intentos contra una cuenta y otra persona distinta, con su
  // contraseña correcta, recibía 429.
  //
  // Lo que lo hacía inevitable es que `next start` rellena `x-forwarded-for` él
  // mismo con la dirección del socket, de modo que nunca falta y siempre es la
  // del proxy.
  console.log("\nUna cuenta machacada no cierra las demás");
  const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const victima = `victima-${sufijo}@example.com`;
  const ajeno = `ajeno-${sufijo}@example.com`;
  const clave = "una frase larga de prueba";

  const dora = client();
  await dora("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Dora", email: victima, password: clave }) });
  const elena = client();
  await elena("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Elena", email: ajeno, password: clave }) });

  const entrar = (quien, email, password) => quien("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  check("Elena entra sin problema de partida", (await entrar(elena, ajeno, clave)).status, 200);

  for (let i = 0; i < 12; i++) await entrar(client(), victima, `equivocada-${i}`);

  check("la cuenta machacada sí queda frenada", (await entrar(dora, victima, clave)).status, 429);
  check("pero quien no tiene nada que ver entra igual", (await entrar(elena, ajeno, clave)).status, 200);

  // ── Cleanup ────────────────────────────────────────────────────────
  await alice(`/api/trips/${aliceTrip.id}`, { method: "DELETE" });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
