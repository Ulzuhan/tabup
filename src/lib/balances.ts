import type { Trip, Expense, Balance, Settlement } from "./types";

/**
 * Balance and settlement maths.
 *
 * Free of any server import so the browser can run it too. An expense written while
 * offline sits in a local queue, and the only honest way to show its effect on who owes
 * whom is to recompute in the client with exactly the code the server uses — two
 * implementations would drift, and the first symptom would be the app and the server
 * disagreeing about money.
 */

export function calculateBalances(trip: Trip): Balance[] {
  const balances: Record<string, { paid: number; share: number }> = {};

  for (const member of trip.members) {
    balances[member.id] = { paid: 0, share: 0 };
  }

  for (const expense of trip.expenses) {
    if (balances[expense.paidBy]) {
      balances[expense.paidBy].paid += expense.amountEur;
    }
    const splitCount = expense.splitAmong.length;
    if (splitCount > 0) {
      const shares = expense.splitShares;
      if (shares && Object.keys(shares).length > 0) {
        const totalWeight = Object.values(shares).reduce((s, w) => s + w, 0);
        if (totalWeight > 0) {
          for (const memberId of expense.splitAmong) {
            if (balances[memberId] && shares[memberId]) {
              balances[memberId].share += (expense.amountEur * shares[memberId]) / totalWeight;
            }
          }
        }
      } else {
        const sharePerPerson = expense.amountEur / splitCount;
        for (const memberId of expense.splitAmong) {
          if (balances[memberId]) {
            balances[memberId].share += sharePerPerson;
          }
        }
      }
    }
  }

  // Payments: "from" settles part of their debt, "to" is owed less.
  for (const payment of trip.payments || []) {
    if (balances[payment.from]) balances[payment.from].share -= payment.amount;
    if (balances[payment.to]) balances[payment.to].paid -= payment.amount;
  }

  return trip.members.map((member) => {
    const b = balances[member.id] || { paid: 0, share: 0 };
    return {
      memberId: member.id,
      totalPaid: Math.round(b.paid * 100) / 100,
      totalShare: Math.round(b.share * 100) / 100,
      balance: Math.round((b.paid - b.share) * 100) / 100,
    };
  });
}

/** Minimal set of transfers that settles everyone up. */
export function calculateSettlements(trip: Trip): Settlement[] {
  const balances = calculateBalances(trip);
  const settlements: Settlement[] = [];

  const creditors = balances.filter((b) => b.balance > 0.01).map((b) => ({ id: b.memberId, amount: b.balance }));
  const debtors = balances.filter((b) => b.balance < -0.01).map((b) => ({ id: b.memberId, amount: -b.balance }));

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0.01) {
      settlements.push({
        from: debtors[i].id,
        to: creditors[j].id,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return settlements;
}

/**
 * What each participant owes for a single expense.
 *
 * The same weighting `calculateBalances` applies, exposed on its own so the CSV and the
 * printable report can show the split per row without recomputing it differently and
 * ending up with columns that do not add to the total.
 */
export function expenseShares(expense: Expense): Record<string, number> {
  const result: Record<string, number> = {};
  const weights = expense.splitShares;

  if (weights && Object.keys(weights).length > 0) {
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight > 0) {
      for (const memberId of expense.splitAmong) {
        if (weights[memberId]) {
          result[memberId] = (expense.amountEur * weights[memberId]) / totalWeight;
        }
      }
    }
    return result;
  }

  const count = expense.splitAmong.length;
  if (count === 0) return result;
  for (const memberId of expense.splitAmong) result[memberId] = expense.amountEur / count;
  return result;
}
