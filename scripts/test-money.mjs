#!/usr/bin/env node
/**
 * The arithmetic, end to end through the API.
 *
 *   TABUP_REGISTRATION=open npm run start &
 *   npm run test:money
 *
 * These are the two things that went wrong and were only found by looking: a trip in a
 * currency other than the euro showed euro figures wearing the wrong symbol, and a split
 * that did not divide evenly quietly lost a cent. Both are invisible until somebody
 * checks the total against what they actually paid, which is exactly why they are here
 * rather than left to a careful reading.
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
  const call = async (path, options = {}) => {
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
    return res;
  };

  const api = async (path, options) => {
    const res = await call(path, options);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  /** For the CSV, which is not JSON. */
  api.text = async (path) => {
    const res = await call(path);
    return { status: res.status, body: await res.text() };
  };
  return api;
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
const round = (n) => Math.round(n * 100) / 100;

async function main() {
  console.log(`Testing against ${BASE}\n`);

  const api = client();
  assertNotThrottled(
    await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: `money-${uniq()}@example.com`,
        name: "Money",
        password: "a long enough password",
      }),
    })
  );

  /**
   * A trip with `names` participants in `currency`, and the ids back.
   *
   * The account creating it is its first participant, so the first name is applied to
   * that seat rather than added next to it — otherwise every split below would quietly
   * be shared one way further than the arithmetic being checked.
   */
  const trip = async (currency, names) => {
    const { body } = await api("/api/trips", {
      method: "POST",
      body: JSON.stringify({
        name: `${currency} trip`,
        currency,
        members: names.slice(1).map((name) => ({ name })),
      }),
    });
    const { body: renamed } = await api(`/api/trips/${body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ renameMember: { id: body.members[0].id, name: names[0] } }),
    });
    return { id: body.id, members: (renamed.members ?? body.members).map((m) => m.id) };
  };

  const spend = (id, paidBy, amount, currency, extra = {}) =>
    api(`/api/trips/${id}/expense`, {
      method: "POST",
      body: JSON.stringify({ description: "x", amount, currency, paidBy, ...extra }),
    });

  const read = async (id) => (await api(`/api/trips/${id}`)).body;

  // ── The trip's own currency is the unit ─────────────────────────────
  console.log("Currency");
  const pesos = await trip("PHP", ["Ana", "Bea"]);
  await spend(pesos.id, pesos.members[0], 1000, "PHP");

  let state = await read(pesos.id);
  check("a peso trip totals in pesos, not euros", state.totalExpenses, 1000);
  check("and splits them in pesos", state.balances.map((b) => b.balance), [500, -500]);
  check("the settlement too", state.settlements[0].amount, 500);

  // A euro expense inside a peso trip is the case that needs a rate. The rate itself
  // moves daily, so what is asserted is the shape: converted, not passed through.
  const foreign = await spend(pesos.id, pesos.members[0], 50, "EUR");
  const converted = foreign.body.expense?.amountBase ?? foreign.body.amountBase;
  check("a euro expense keeps its own amount", foreign.body.expense?.amount ?? foreign.body.amount, 50);
  check("and is converted into pesos", converted > 1000 && converted < 10000, true);

  const euros = await trip("EUR", ["Ana", "Bea"]);
  await spend(euros.id, euros.members[0], 100, "EUR");
  state = await read(euros.id);
  check("a euro trip is unchanged", state.totalExpenses, 100);

  // ── Not a cent goes missing ─────────────────────────────────────────
  console.log("\nCents");
  const three = await trip("EUR", ["A", "B", "C"]);
  await spend(three.id, three.members[0], 10, "EUR");

  state = await read(three.id);
  const balances = state.balances.map((b) => b.balance);
  check("ten between three balances to zero", round(balances.reduce((a, b) => a + b, 0)), 0);
  check("with the odd cent on somebody", balances, [6.66, -3.33, -3.33]);
  check(
    "and the settlements pay the debt in full",
    round(state.settlements.reduce((sum, s) => sum + s.amount, 0)),
    6.66
  );

  // A weighted split has the same problem, and the remainder must still land somewhere.
  const weighted = await trip("EUR", ["A", "B", "C"]);
  await spend(weighted.id, weighted.members[0], 100, "EUR", {
    splitShares: {
      [weighted.members[0]]: 1,
      [weighted.members[1]]: 1,
      [weighted.members[2]]: 1,
    },
  });
  state = await read(weighted.id);
  check(
    "an uneven split loses nothing either",
    round(state.balances.reduce((sum, b) => sum + b.balance, 0)),
    0
  );

  // Seven people, an awkward number: six cents to hand out, one each.
  const seven = await trip("EUR", ["A", "B", "C", "D", "E", "F", "G"]);
  await spend(seven.id, seven.members[0], 0.1, "EUR");
  state = await read(seven.id);
  check(
    "ten cents between seven still balances",
    round(state.balances.reduce((sum, b) => sum + b.balance, 0)),
    0
  );

  // ── Settling up actually settles ────────────────────────────────────
  console.log("\nSettling");
  for (const s of state.settlements) {
    await api(`/api/trips/${seven.id}/payment`, {
      method: "POST",
      body: JSON.stringify({ from: s.from, to: s.to, amount: s.amount }),
    });
  }
  state = await read(seven.id);
  check("paying every suggested transfer clears the board", state.settlements.length, 0);
  check(
    "and leaves nobody owed anything",
    state.balances.every((b) => b.balance === 0),
    true
  );

  // ── Dates ───────────────────────────────────────────────────────────
  // A malformed date used to reach the insert as NaN and come back as a 500.
  console.log("\nBad input is not a server error");
  const dates = await trip("EUR", ["A", "B"]);
  check(
    "a nonsense date is rejected, not crashed on",
    (await spend(dates.id, dates.members[0], 10, "EUR", { date: "not-a-date" })).status,
    400
  );
  check(
    "a real date is accepted",
    (await spend(dates.id, dates.members[0], 10, "EUR", { date: "2026-03-14" })).status,
    200
  );
  check(
    "a nonsense payment date too",
    (
      await api(`/api/trips/${dates.id}/payment`, {
        method: "POST",
        body: JSON.stringify({
          from: dates.members[0],
          to: dates.members[1],
          amount: 5,
          date: "nope",
        }),
      })
    ).status,
    400
  );

  // ── The CSV agrees with the screen ──────────────────────────────────
  //
  // A spreadsheet that disagrees with the app about the total is worse than no export
  // at all, because it is the version somebody takes away and trusts.
  console.log("\nExport");
  const csv = await api.text(`/api/trips/${three.id}/export`);
  check("the CSV comes back", csv.status, 200);
  check("with the trip total in it", csv.body.includes("10.00"), true);
  check("and the names, not the ids", csv.body.includes('"A"'), true);
  check("and a per-person share that adds up", csv.body.includes("3.34") || csv.body.includes("3.33"), true);

  const stranger = client();
  check(
    "and a stranger cannot download it",
    (await stranger(`/api/trips/${three.id}/export`)).status,
    404
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
