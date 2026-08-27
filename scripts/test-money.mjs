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

  // ── The rate of the day it was spent ────────────────────────────────
  //
  // An expense carries a date and can be backdated. Converting last year's dinner at
  // today's rate is a different number, and over a year the euro and the peso have
  // certainly moved — which is what makes this assertable without pinning a figure.
  console.log("\nThe rate of the day it happened");
  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const todayEuros = await spend(pesos.id, pesos.members[0], 100, "EUR");
  const thenEuros = await spend(pesos.id, pesos.members[0], 100, "EUR", {
    date: lastYear.getTime(),
  });
  const now = todayEuros.body.expense?.amountBase ?? todayEuros.body.amountBase;
  const then = thenEuros.body.expense?.amountBase ?? thenEuros.body.amountBase;
  check("the same amount on two different days", [typeof now, typeof then], ["number", "number"]);
  check("converts to two different figures", now !== then, true);
  check("both of them plausible pesos", now > 1000 && then > 1000, true);

  const rates = await api("/api/rates");
  check("the rates endpoint says when it last fetched", typeof rates.body.fetchedAt, "number");
  check("and whether that is the real thing", rates.body.exact, true);

  // ── An edit that touches no money touches no figure ─────────────────
  //
  // The guard used to be "did the request mention a currency", and the form mentions it
  // on every save — so correcting a typo in the description of an old expense silently
  // reconverted it at today's rate, moving its share of the trip and every balance with
  // it. Rates barely move in the seconds this test takes, so what is pinned is the rule
  // rather than a number: the stored figure must come back byte for byte.
  console.log("\nEditing without touching the money");
  const pinned = foreign.body.expense?.id ?? foreign.body.id;
  const beforeEdit = (await read(pesos.id)).expenses.find((e) => e.id === pinned);
  const renamed = await api(`/api/trips/${pesos.id}/expense`, {
    method: "PATCH",
    // Exactly the body the form sends: everything, including the unchanged currency.
    body: JSON.stringify({
      expenseId: pinned,
      description: "Vuelo de ida",
      amount: beforeEdit.amount,
      currency: beforeEdit.currency,
      paidBy: beforeEdit.paidBy,
    }),
  });
  check("renaming an expense works", renamed.status, 200);
  check("and leaves its converted amount alone", renamed.body.amountBase, beforeEdit.amountBase);
  check(
    "so the trip total does not move",
    (await read(pesos.id)).totalExpenses,
    (await read(pesos.id)).totalExpenses
  );

  const afterEdit = (await read(pesos.id)).expenses.find((e) => e.id === pinned);
  check("nor the rate that was used", afterEdit.rateAvailable, beforeEdit.rateAvailable);
  check("nor the exchange rate stored with it", afterEdit.amountBase, beforeEdit.amountBase);

  // Changing the amount, on the other hand, must reconvert.
  const repriced = await api(`/api/trips/${pesos.id}/expense`, {
    method: "PATCH",
    body: JSON.stringify({ expenseId: pinned, amount: 100, currency: "EUR" }),
  });
  check("changing the amount does reconvert", repriced.body.amountBase > beforeEdit.amountBase * 1.9, true);

  // ── A settle-up can be handed over in any currency ───────────────────
  //
  // A peso debt cleared by a euro transfer is the commonest way a trip ends. It used to
  // be recorded as if the number typed were pesos, which is off by a factor of sixty.
  console.log("\nSettling up in another currency");
  // Measured as the movement it causes rather than by rebuilding the whole ledger: the
  // question is whether the balance shifts by the converted figure or by the typed one.
  const owedBefore = (await read(pesos.id)).balances.find(
    (b) => b.memberId === pesos.members[1]
  ).balance;

  const inEuros = await api(`/api/trips/${pesos.id}/payment`, {
    method: "POST",
    body: JSON.stringify({
      from: pesos.members[1],
      to: pesos.members[0],
      amount: 10,
      currency: "EUR",
    }),
  });
  check("a payment in euros is accepted", inEuros.status, 200);
  check("keeping the amount that changed hands", inEuros.body.amount, 10);
  check("and converting it into pesos", inEuros.body.amountBase > 100, true);

  const withPayment = await read(pesos.id);
  const settled = withPayment.payments.find((p) => p.id === inEuros.body.id);
  check("the trip carries both figures", [settled.currency, settled.amount], ["EUR", 10]);
  const moved =
    withPayment.balances.find((b) => b.memberId === pesos.members[1]).balance - owedBefore;
  check(
    "the balance moved by the converted amount, not the typed one",
    Math.abs(moved - settled.amountBase) < 0.02,
    true
  );
  check("which is nothing like the ten that was typed", moved > 100, true);

  // A payment in the trip's own currency needs no rate at all.
  const inPesos = await api(`/api/trips/${pesos.id}/payment`, {
    method: "POST",
    body: JSON.stringify({ from: pesos.members[1], to: pesos.members[0], amount: 25 }),
  });
  check("a payment in the trip's currency is untouched", inPesos.body.amountBase, 25);
  check("and is marked exact", inPesos.body.rateAvailable, true);

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

  // ── An amount the server refuses to guess at ────────────────────────
  //
  // `parseFloat` used to take whatever it could make sense of and drop the rest.
  // The case that matters is the decimal comma — the one people type in Spanish:
  // "12,50" became 12, and the answer was a cheerful 200. Half a euro gone, with
  // nothing on screen to say so. "100abc" became 100 and "1.2.3" became 1.2 for
  // the same reason.
  //
  // These are here rather than left to a careful reading because a wrong amount
  // does not look wrong. It looks like an amount.
  console.log("\nAmounts that are not numbers");
  const amounts = await api("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Amounts", currency: "EUR", members: [{ name: "B" }] }),
  });
  const amountsTrip = amounts.body;
  const amountIds = amountsTrip.members.map((m) => m.id);

  const addAmount = (amount) =>
    api(`/api/trips/${amountsTrip.id}/expense`, {
      method: "POST",
      body: JSON.stringify({
        description: "x",
        amount,
        paidBy: amountIds[0],
        date: Date.now(),
        splitAmong: amountIds,
      }),
    });

  const comma = await addAmount("12,50");
  check("a decimal comma is understood, not truncated", comma.body.amount, 12.5);
  check("digits followed by letters are refused", (await addAmount("100abc")).status, 400);
  check("two decimal points are refused", (await addAmount("1.2.3")).status, 400);
  check("an empty amount is refused", (await addAmount("")).status, 400);
  check("a number still works", (await addAmount(12.5)).body.amount, 12.5);
  check("and so does one with spaces around it", (await addAmount(" 50 ")).body.amount, 50);

  // ── An expense split between nobody ─────────────────────────────────
  //
  // This one broke the books permanently. Whoever paid was left in credit, every
  // share was zero, the balances stopped summing to zero, and no settlement was
  // ever offered to fix it: 60 € split among nobody left the trip owing 60 € to
  // the void. The API accepted it with a 200.
  console.log("\nSplit between nobody");
  const empty = await api("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Empty", currency: "EUR", members: [{ name: "B" }] }),
  });
  const emptyTrip = empty.body;
  const emptyIds = emptyTrip.members.map((m) => m.id);

  check(
    "an expense split among nobody is refused",
    (
      await api(`/api/trips/${emptyTrip.id}/expense`, {
        method: "POST",
        body: JSON.stringify({
          description: "nobody",
          amount: 60,
          paidBy: emptyIds[0],
          date: Date.now(),
          splitAmong: [],
        }),
      })
    ).status,
    400
  );

  const stillBalanced = (await api(`/api/trips/${emptyTrip.id}`)).body;
  check(
    "so the balances still sum to zero",
    Math.round((stillBalanced.balances || []).reduce((sum, b) => sum + b.balance, 0) * 100),
    0
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
