#!/usr/bin/env node
/**
 * Two people doing the same thing at the same instant.
 *
 *   rm -f data/test.db* && TABUP_DB=data/test.db TABUP_REGISTRATION=open npm run start &
 *   npm run test:races
 *
 * Every pair goes out with Promise.all, so both requests are in flight before either
 * finishes — which is what a check-then-act sequence spanning two statements cannot
 * survive unless something else is protecting it. Mostly something is: SQLite takes one
 * writer at a time, and the destructive updates carry their precondition in the WHERE
 * clause rather than in a preceding SELECT.
 *
 * Two of these pin a *policy* rather than a safety property, and are worth reading as
 * such: simultaneous edits are last-write-wins, and what matters is that the survivor is
 * one whole edit rather than halves of two. Both are recorded in the activity feed, so
 * the one that lost is not invisible.
 */
const BASE = process.env.BASE || "http://127.0.0.1:3113";

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

const uniq = () => Math.random().toString(36).slice(2, 10);
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

/** Both went through, or one did and the other was refused for the right reason. */
const outcome = (results) => results.map((r) => r.status).sort().join("/");

async function register(api, name) {
  const email = `${name}-${uniq()}@example.com`;
  const res = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name, password: "a long enough password" }),
  });
  if (res.status === 429) {
    console.error("throttled — restart against a fresh database");
    process.exit(1);
  }
  return email;
}

const alice = client();
const aliceEmail = await register(alice, "Alice");

// ── Two people claiming the same free seat ────────────────────────────
console.log("\nTwo people claiming the same seat");
{
  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Claim", currency: "EUR", members: [{ name: "Libre" }] }),
    })
  ).body;
  const free = trip.members.find((m) => m.name === "Libre").id;

  const invite = await alice(`/api/trips/${trip.id}/invite`, { method: "POST" });
  const two = [client(), client()];
  for (const c of two) {
    await register(c, "R" + uniq());
    await c("/api/join", { method: "POST", body: JSON.stringify({ token: invite.body.token }) });
  }

  const results = await Promise.all(
    two.map((c) =>
      c(`/api/trips/${trip.id}/claim`, { method: "POST", body: JSON.stringify({ memberId: free }) })
    )
  );
  check("exactly one of them gets it", outcome(results), "200/409");

  const after = (await alice(`/api/trips/${trip.id}`)).body;
  const seat = after.members.find((m) => m.id === free);
  check("and the seat belongs to somebody", Boolean(seat.userId), true);
  check("with no extra column invented", after.members.length, 2);
}

// ── The same address added twice at once ──────────────────────────────
console.log("\nThe same address added twice at once");
{
  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Invite", currency: "EUR", members: [] }),
    })
  ).body;
  const stranger = `nadie-${uniq()}@example.com`;

  const results = await Promise.all([
    alice(`/api/trips/${trip.id}`, {
      method: "PATCH",
      body: JSON.stringify({ addByEmail: stranger }),
    }),
    alice(`/api/trips/${trip.id}`, {
      method: "PATCH",
      body: JSON.stringify({ addByEmail: stranger }),
    }),
  ]);
  check("both are accepted", outcome(results), "200/200");

  const after = (await alice(`/api/trips/${trip.id}`)).body;
  const seats = after.members.filter((m) => m.name.startsWith(stranger.split("@")[0]));
  check("but only one seat is made", seats.length, 1);
  check("and only one invitation is live", new Set(results.map((r) => r.body.invite?.token)).size, 1);
}

// ── An account added twice at once ────────────────────────────────────
console.log("\nThe same account added twice at once");
{
  const bob = client();
  const bobEmail = await register(bob, "Bob");
  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Double", currency: "EUR", members: [] }),
    })
  ).body;

  const results = await Promise.all([
    alice(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ addByEmail: bobEmail }) }),
    alice(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ addByEmail: bobEmail }) }),
  ]);
  check("the second is told they are already in", outcome(results), "200/409");
  const after = (await alice(`/api/trips/${trip.id}`)).body;
  check("and Bob has one seat, not two", after.members.filter((m) => m.accountName === "Bob").length, 1);
}

// ── Two people editing the same expense ───────────────────────────────
console.log("\nTwo edits of the same expense");
{
  const bob = client();
  const bobEmail = await register(bob, "Bob2");
  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Edit", currency: "EUR", members: [] }),
    })
  ).body;
  await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: bobEmail }),
  });
  const seat = (await alice(`/api/trips/${trip.id}`)).body.you;

  const expense = await alice(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Cena", amount: 100, paidBy: seat, category: "food" }),
  });

  // Alice wrote it, so both of them may change it: she as the author, Bob as nobody —
  // the owner. Alice is the owner here, so Bob is refused; use two owner-equivalent
  // edits instead by having Alice send both.
  const results = await Promise.all([
    alice(`/api/trips/${trip.id}/expense`, {
      method: "PATCH",
      body: JSON.stringify({ expenseId: expense.body.id, description: "Cena de Ana", amount: 111 }),
    }),
    alice(`/api/trips/${trip.id}/expense`, {
      method: "PATCH",
      body: JSON.stringify({ expenseId: expense.body.id, description: "Cena de Bea", amount: 222 }),
    }),
  ]);
  check("both edits are accepted", outcome(results), "200/200");

  const after = (await alice(`/api/trips/${trip.id}`)).body.expenses[0];
  // Last write wins — a policy, not an accident. What must never happen is the two being
  // interleaved into an expense that nobody wrote.
  check(
    "and the survivor is one whole edit, not halves of two",
    after.description.includes("Ana") === (after.amount === 111),
    true
  );
  check("with the amount from that same edit", [111, 222].includes(after.amount), true);
}

// ── Editing something that is being deleted ───────────────────────────
console.log("\nEditing something as it is deleted");
{
  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Race", currency: "EUR", members: [] }),
    })
  ).body;
  const seat = (await alice(`/api/trips/${trip.id}`)).body.you;
  const expense = await alice(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Taxi", amount: 10, paidBy: seat, category: "transport" }),
  });

  const results = await Promise.all([
    alice(`/api/trips/${trip.id}/expense`, {
      method: "PATCH",
      body: JSON.stringify({ expenseId: expense.body.id, amount: 99 }),
    }),
    alice(`/api/trips/${trip.id}/expense`, {
      method: "DELETE",
      body: JSON.stringify({ expenseId: expense.body.id }),
    }),
  ]);
  check("neither request breaks the server", results.every((r) => r.status < 500), true);
  check("and the expense is gone rather than half-edited", (await alice(`/api/trips/${trip.id}`)).body.expenses.length, 0);
}

// ── Two people taking the trip at once ────────────────────────────────
console.log("\nTwo hand-overs at once");
{
  const bob = client();
  const bobEmail = await register(bob, "Bob3");
  const carol = client();
  const carolEmail = await register(carol, "Carol");
  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Hand", currency: "EUR", members: [] }),
    })
  ).body;
  for (const email of [bobEmail, carolEmail]) {
    await alice(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ addByEmail: email }) });
  }
  const members = (await alice(`/api/trips/${trip.id}`)).body.members;
  const bobSeat = members.find((m) => m.accountName === "Bob3").id;
  const carolSeat = members.find((m) => m.accountName === "Carol").id;

  const results = await Promise.all([
    alice(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ transferOwner: bobSeat }) }),
    alice(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ transferOwner: carolSeat }) }),
  ]);
  // The second arrives when Alice is no longer the owner, so it is refused by the same
  // rule that refuses anybody else.
  check("only one hand-over goes through", outcome(results), "200/403");
  const owners = [
    (await bob(`/api/trips/${trip.id}`)).body.access,
    (await carol(`/api/trips/${trip.id}`)).body.access,
  ];
  check("and the trip has exactly one owner", owners.filter((a) => a === "owner").length, 1);
  check("with Alice left inside as a member", (await alice(`/api/trips/${trip.id}`)).body.access, "member");
}

// ── The same person removed twice at once ─────────────────────────────
console.log("\nThe same person removed twice at once");
{
  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Remove", currency: "EUR", members: [{ name: "Libre" }] }),
    })
  ).body;
  const free = trip.members.find((m) => m.name === "Libre").id;

  const results = await Promise.all([
    alice(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ removeMembers: [free] }) }),
    alice(`/api/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ removeMembers: [free] }) }),
  ]);
  check("removing twice is not an error", outcome(results), "200/200");
  check("and takes out one person, not two", (await alice(`/api/trips/${trip.id}`)).body.members.length, 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
}
