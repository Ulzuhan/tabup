#!/usr/bin/env node
/**
 * Integration tests for the trip API.
 *
 * Runs against a live server, no dependencies and no test framework:
 *
 *   TABUP_ALLOW_REGISTRATION=true npm run start &
 *   npm run test:api
 *
 * The concurrency case is the important one. Before the SQLite migration this API
 * lost data: five simultaneous expenses produced two 500s and a single surviving
 * expense, with two requests answering 200 while their data vanished.
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

/**
 * Keeps the session cookie between calls.
 *
 * Every trip belongs to an account now — there is no anonymous mode — so the suite
 * signs in once and works as that user.
 */
let cookie = "";

const api = async (path, options = {}) => {
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

const newTrip = (names = ["Ana", "Bea"]) =>
  api("/api/trips", {
    method: "POST",
    body: JSON.stringify({
      name: "Test trip",
      currency: "EUR",
      members: names.map((name) => ({ name })),
    }),
  });

async function main() {
  console.log(`Testing against ${BASE}\n`);

  const health = await fetch(`${BASE}/api/auth/me`).catch(() => null);
  if (!health?.ok) {
    console.error(`No server at ${BASE}. Start one with: npm run start`);
    process.exit(1);
  }

  // Needs TABUP_ALLOW_REGISTRATION=true unless the database is empty.
  const signUp = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `api-${Math.random().toString(36).slice(2, 10)}@example.com`,
      name: "API",
      password: "a password for the suite",
    }),
  });
  if (signUp.status !== 200) {
    console.error(`Could not create an account (HTTP ${signUp.status}). Start the server with TABUP_ALLOW_REGISTRATION=true.`);
    process.exit(1);
  }

  // ── Concurrency: the regression this whole migration is about ──────
  console.log("Concurrent writes");
  {
    const { body: trip } = await newTrip();
    const payer = trip.members[0].id;

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        api(`/api/trips/${trip.id}/expense`, {
          method: "POST",
          body: JSON.stringify({
            description: `Expense ${i}`,
            amount: 10,
            paidBy: payer,
            category: "food",
          }),
        })
      )
    );

    check("every request succeeds", results.every((r) => r.status === 200), true);
    const { body: after } = await api(`/api/trips/${trip.id}`);
    check("no expense is lost", after.expenses.length, 10);
    check("total is right", after.totalExpenses, 100);
    await api(`/api/trips/${trip.id}`, { method: "DELETE" });
  }

  // ── Splitting and balances ─────────────────────────────────────────
  console.log("\nSplitting and balances");
  const { body: trip } = await newTrip();
  const [ana, bea] = trip.members.map((m) => m.id);

  const { body: dinner } = await api(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Dinner", amount: 60, paidBy: ana, category: "food" }),
  });
  check("splits among everyone by default", dinner.splitAmong.length, 2);

  let { body: state } = await api(`/api/trips/${trip.id}`);
  check("payer is owed half", state.balances.find((b) => b.name === "Ana").balance, 30);
  check("one settlement covers it", state.settlements.length, 1);

  const { body: hotel } = await api(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Hotel",
      amount: 100,
      paidBy: ana,
      category: "accommodation",
      splitAmong: [ana, bea],
      splitShares: { [ana]: 3, [bea]: 1 },
    }),
  });
  ({ body: state } = await api(`/api/trips/${trip.id}`));
  const stored = state.expenses.find((e) => e.id === hotel.id);
  check("uneven split is preserved", Object.keys(stored.splitShares ?? {}).length, 2);

  // ── Editing and deleting ───────────────────────────────────────────
  console.log("\nEditing and deleting");
  await api(`/api/trips/${trip.id}/expense`, {
    method: "PATCH",
    body: JSON.stringify({ expenseId: dinner.id, amount: 80 }),
  });
  ({ body: state } = await api(`/api/trips/${trip.id}`));
  check("amount is updated", state.expenses.find((e) => e.id === dinner.id).amount, 80);

  const del = await api(`/api/trips/${trip.id}/expense`, {
    method: "DELETE",
    body: JSON.stringify({ expenseId: dinner.id }),
  });
  check("expense is deleted", del.status, 200);

  // ── Payments ───────────────────────────────────────────────────────
  console.log("\nPayments");
  const { body: payment } = await api(`/api/trips/${trip.id}/payment`, {
    method: "POST",
    body: JSON.stringify({ from: bea, to: ana, amount: 20 }),
  });
  check("payment is recorded", payment.amount, 20);

  const self = await api(`/api/trips/${trip.id}/payment`, {
    method: "POST",
    body: JSON.stringify({ from: ana, to: ana, amount: 5 }),
  });
  check("paying yourself is rejected", self.status, 400);

  // ── Members ────────────────────────────────────────────────────────
  console.log("\nMembers");
  await api(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addMembers: ["Cris"] }),
  });
  ({ body: state } = await api(`/api/trips/${trip.id}`));
  check("member is added", state.members.length, 3);

  const dup = await api(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addMembers: ["Ana"] }),
  });
  check("duplicate name is rejected", dup.status, 400);

  // ── Validation ─────────────────────────────────────────────────────
  console.log("\nValidation");
  const negative = await api(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Bad", amount: -5, paidBy: ana, category: "food" }),
  });
  check("negative amount is rejected", negative.status, 400);

  const stranger = await api(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Bad", amount: 5, paidBy: "deadbeef", category: "food" }),
  });
  check("unknown payer is rejected", stranger.status, 400);

  const traversal = await fetch(`${BASE}/api/trips/..%2f..%2fetc%2fpasswd`, { headers: { cookie } });
  check("path traversal is rejected", [400, 404].includes(traversal.status), true);

  const exported = await fetch(`${BASE}/api/trips/${trip.id}/export`, { headers: { cookie } });
  check("CSV export works", exported.status, 200);

  await api(`/api/trips/${trip.id}`, { method: "DELETE" });
  const gone = await api(`/api/trips/${trip.id}`);
  check("deleted trip is gone", gone.status, 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
