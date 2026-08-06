"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Expense, Payment, Trip } from "@/lib/types";
import { useT } from "@/i18n/provider";
import { calculateBalances, calculateSettlements } from "@/lib/balances";
import {
  allPending,
  flushQueue,
  pendingFor,
  subscribeToQueue,
  type PendingWrite,
} from "@/lib/write-queue";

/** An expense that only exists in this browser so far. */
export interface PendingExpense extends Expense {
  pending: true;
  clientId: string;
}

/**
 * Queued writes for a trip, kept in step with the queue itself.
 *
 * Also flushes on mount and whenever the connection comes back, which is the moment
 * that matters: walking back into wifi should quietly deliver everything typed on the
 * mountain, with no button to press.
 */
export function usePendingWrites(tripId: string, onDelivered: () => void) {
  const [pending, setPending] = useState<PendingWrite[]>([]);
  const t = useT();

  // The callback is held in a ref updated from an effect, never during render: callers
  // pass a fresh closure each time, and depending on it directly would resubscribe and
  // re-flush on every single render.
  const delivered = useRef(onDelivered);
  useEffect(() => {
    delivered.current = onDelivered;
  }, [onDelivered]);

  const refresh = useCallback(async () => {
    setPending(await pendingFor(tripId));
  }, [tripId]);

  const attemptFlush = useCallback(async () => {
    const { sent, dropped } = await flushQueue();
    await refresh();
    // Only refetch when something actually landed; otherwise this would hammer the
    // server every time the browser flaps between networks.
    if (sent > 0) delivered.current();
    // A write the server refused outright is gone, and it was somebody's money. It used
    // to disappear into a console warning; whoever typed it deserves to hear about it.
    if (dropped > 0) toast.error(t("offline.dropped", { count: dropped }));
  }, [refresh, t]);

  useEffect(() => {
    // Deferred so no state is set during the render pass; both of these resolve after
    // IndexedDB answers anyway.
    Promise.resolve().then(refresh);
    // Flush on mount too: the queue may be left over from a previous session that was
    // closed before the connection returned.
    Promise.resolve().then(attemptFlush);

    const unsubscribe = subscribeToQueue(() => {
      Promise.resolve().then(refresh);
    });
    const onOnline = () => attemptFlush();
    window.addEventListener("online", onOnline);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [refresh, attemptFlush]);

  return { pending, refresh, flush: attemptFlush };
}

/**
 * Folds queued writes into the trip as if they had been saved.
 *
 * Balances are recomputed from the merged set with the same functions the server runs,
 * so the figures move the moment an expense is typed. Showing the expense but leaving
 * the balances stale would be worse than useless — the balances are the reason anyone
 * opens this.
 */
export function mergePending(
  trip: Trip & { totalExpenses: number },
  pending: PendingWrite[]
): {
  expenses: (Expense | PendingExpense)[];
  totalExpenses: number;
  balances: ReturnType<typeof calculateBalances>;
  settlements: ReturnType<typeof calculateSettlements>;
  pendingCount: number;
} {
  const pendingExpenses: PendingExpense[] = [];
  const pendingPayments: Payment[] = [];

  for (const write of pending) {
    const body = write.body as Record<string, never>;

    if (write.kind === "expense") {
      const amount = Number(body.amount) || 0;
      pendingExpenses.push({
        id: `pending-${write.clientId}`,
        clientId: write.clientId,
        pending: true,
        description: String(body.description ?? ""),
        amount,
        currency: String(body.currency ?? trip.currency),
        // No conversion is possible without the network, so a foreign-currency expense
        // counts at face value until it syncs — and says so, which is the half that was
        // missing: the flag below was hardcoded true, so the warning the comment
        // promised never appeared and the balances looked exact while they were not.
        amountBase: Number(body.amountBase ?? amount),
        paidBy: String(body.paidBy ?? ""),
        splitAmong: (body.splitAmong as string[] | undefined) ?? trip.members.map((m) => m.id),
        splitShares: body.splitShares as Record<string, number> | undefined,
        category: String(body.category ?? "other"),
        date: Number(body.date ?? write.createdAt),
        rateAvailable: String(body.currency ?? trip.currency) === trip.currency,
      });
    } else {
      const paid = Number(body.amount) || 0;
      const payCurrency = String(body.currency ?? trip.currency);
      pendingPayments.push({
        id: `pending-${write.clientId}`,
        from: String(body.from ?? ""),
        to: String(body.to ?? ""),
        amount: paid,
        currency: payCurrency,
        // Same as an expense: no conversion is possible without the network, so it
        // counts at face value and says so until it syncs.
        amountBase: paid,
        rateAvailable: payCurrency === trip.currency,
        date: Number(body.date ?? write.createdAt),
        note: body.note as string | undefined,
      });
    }
  }

  const expenses = [...trip.expenses, ...pendingExpenses];
  const merged: Trip = {
    ...trip,
    expenses,
    payments: [...trip.payments, ...pendingPayments],
  };

  return {
    expenses,
    totalExpenses:
      Math.round(expenses.reduce((sum, e) => sum + e.amountBase, 0) * 100) / 100,
    balances: calculateBalances(merged),
    settlements: calculateSettlements(merged),
    pendingCount: pending.length,
  };
}

/** How many writes are waiting across every trip, for the home screen. */
export function useTotalPending(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const refresh = async () => setCount((await allPending()).length);
    refresh();
    return subscribeToQueue(refresh);
  }, []);

  return count;
}
