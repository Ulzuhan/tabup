import type { Trip, Expense, Balance, Settlement } from "./types";

/**
 * Balance and settlement maths.
 *
 * Free of any server import so the browser can run it too. An expense written while
 * offline sits in a local queue, and the only honest way to show its effect on who owes
 * whom is to recompute in the client with exactly the code the server uses — two
 * implementations would drift, and the first symptom would be the app and the server
 * disagreeing about money.
 *
 * Everything below works in whole cents. Ten euros between three people is the case
 * that shows why: a third of ten is 3.333…, and rounding each share on its own gave
 * 3.33 apiece, which is 9.99 — a cent short. The balances then did not sum to zero, the
 * settlements paid 6.66 of a 6.67 debt, and the missing cent vanished from view under a
 * tolerance rather than being owed to anybody. So a split now hands out every cent it
 * was given: the remainder goes one cent at a time, in a fixed order, to the people the
 * split names.
 */

/** Cents in, cents out. Halves go up, which is what a person doing this by hand does. */
const toCents = (amount: number) => Math.round(amount * 100);
const toAmount = (cents: number) => cents / 100;

/**
 * Splits a whole number of cents by weight, losing none of them.
 *
 * The remainder is handed out largest-fraction-first — the standard way of apportioning
 * an indivisible unit — and ties break on the order the members were given, so the same
 * expense always splits the same way rather than shifting a cent around between reads.
 */
function divideCents(totalCents: number, weights: [string, number][]): Record<string, number> {
  const result: Record<string, number> = {};
  const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight <= 0 || weights.length === 0) return result;

  const remainders: { id: string; fraction: number; index: number }[] = [];
  let handedOut = 0;

  weights.forEach(([id, weight], index) => {
    const exact = (totalCents * weight) / totalWeight;
    const whole = Math.floor(exact);
    result[id] = whole;
    handedOut += whole;
    remainders.push({ id, fraction: exact - whole, index });
  });

  remainders.sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  // Floor rounds towards negative infinity, so a negative total leaves a surplus rather
  // than a shortfall; either way the loop walks what is left down to nothing.
  let left = totalCents - handedOut;
  for (let i = 0; left !== 0; i = (i + 1) % remainders.length) {
    const step = left > 0 ? 1 : -1;
    result[remainders[i].id] += step;
    left -= step;
  }

  return result;
}

/** The weights an expense splits by: its own if uneven, otherwise one each. */
function splitWeights(expense: Expense): [string, number][] {
  const shares = expense.splitShares;
  if (shares && Object.keys(shares).length > 0) {
    const named = expense.splitAmong.filter((id) => shares[id]);
    if (named.length > 0) return named.map((id): [string, number] => [id, shares[id]]);
  }
  return expense.splitAmong.map((id): [string, number] => [id, 1]);
}

export function calculateBalances(trip: Trip): Balance[] {
  const balances: Record<string, { paid: number; share: number }> = {};

  for (const member of trip.members) {
    balances[member.id] = { paid: 0, share: 0 };
  }

  for (const expense of trip.expenses) {
    const cents = toCents(expense.amountBase);
    if (balances[expense.paidBy]) {
      balances[expense.paidBy].paid += cents;
    }

    const shares = divideCents(cents, splitWeights(expense));
    for (const [memberId, owed] of Object.entries(shares)) {
      // A split naming somebody who has since been removed keeps their cents out of
      // everyone else's share rather than silently redistributing them.
      if (balances[memberId]) balances[memberId].share += owed;
    }
  }

  // Payments: "from" settles part of their debt, "to" is owed less.
  for (const payment of trip.payments || []) {
    const cents = toCents(payment.amount);
    if (balances[payment.from]) balances[payment.from].share -= cents;
    if (balances[payment.to]) balances[payment.to].paid -= cents;
  }

  return trip.members.map((member) => {
    const b = balances[member.id] || { paid: 0, share: 0 };
    return {
      memberId: member.id,
      totalPaid: toAmount(b.paid),
      totalShare: toAmount(b.share),
      balance: toAmount(b.paid - b.share),
    };
  });
}

/**
 * Minimal set of transfers that settles everyone up.
 *
 * In cents throughout, so the transfers add up to exactly what is owed. A single cent
 * still counts: it is somebody's, and the alternative is a balance nobody can clear.
 */
export function calculateSettlements(trip: Trip): Settlement[] {
  const balances = calculateBalances(trip);
  const settlements: Settlement[] = [];

  const creditors = balances
    .filter((b) => toCents(b.balance) > 0)
    .map((b) => ({ id: b.memberId, cents: toCents(b.balance) }));
  const debtors = balances
    .filter((b) => toCents(b.balance) < 0)
    .map((b) => ({ id: b.memberId, cents: -toCents(b.balance) }));

  // Biggest first: the largest debt and the largest credit cancel each other out in one
  // transfer, which is what keeps the list short.
  creditors.sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));
  debtors.sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i].cents, creditors[j].cents);
    if (cents > 0) {
      settlements.push({
        from: debtors[i].id,
        to: creditors[j].id,
        amount: toAmount(cents),
      });
    }
    debtors[i].cents -= cents;
    creditors[j].cents -= cents;
    if (debtors[i].cents === 0) i++;
    if (creditors[j].cents === 0) j++;
  }

  return settlements;
}

/**
 * What each participant owes for a single expense.
 *
 * The same division `calculateBalances` performs, exposed on its own so the CSV and the
 * printable report can show the split per row without recomputing it differently and
 * ending up with columns that do not add to the total.
 */
export function expenseShares(expense: Expense): Record<string, number> {
  const cents = divideCents(toCents(expense.amountBase), splitWeights(expense));
  return Object.fromEntries(Object.entries(cents).map(([id, c]) => [id, toAmount(c)]));
}
