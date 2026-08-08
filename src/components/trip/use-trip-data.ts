"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePendingWrites, mergePending } from "@/lib/use-pending";
import { useT } from "@/i18n/provider";
import { filterExpenses, type ExpenseFilters } from "./expense-filter";
import type { TripData } from "./types";

/**
 * Everything the trip screen reads.
 *
 * Loading, the offline queue, and the several derived views that hang off both live
 * here rather than in the page, which had grown to twenty-two hooks in one function —
 * and hooks in bulk are how you end up calling one after a conditional return, which
 * this app has done twice.
 *
 * The important part is `view`: the server's data with the queued writes folded in, and
 * balances recomputed from the result with the same functions the server uses. An
 * expense typed with no signal moves the figures straight away; showing the expense but
 * leaving the balances behind would be worse than not showing it at all.
 */
export function useTripData(id: string, filters: ExpenseFilters) {
  const t = useT();

  const [trip, setTrip] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  /** The last loaded members, so the payment draft can be seeded once they arrive. */
  const [seeded, setSeeded] = useState<{ from: string; to: string } | null>(null);

  const loadTrip = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${id}`);
      if (!res.ok) {
        setError(t("trip.notFound"));
        return;
      }
      const data: TripData = await res.json();
      setTrip(data);
      // The service worker sets this when it served a cached copy because the network
      // was unreachable, so the page can say the figures are not current.
      setStale(res.headers.get("X-TabUp-Offline") === "1");
      setSeeded({ from: data.members[0]?.id ?? "", to: data.members[1]?.id ?? "" });
    } catch {
      setError(t("trip.notFound"));
    }
  }, [id, t]);

  // Wrapped in a promise callback so nothing updates state during the render pass:
  // every setState inside loadTrip runs after the fetch has resolved.
  useEffect(() => {
    Promise.resolve().then(loadTrip);
  }, [loadTrip]);

  const {
    pending,
    refresh: refreshPending,
    flush: flushPending,
  } = usePendingWrites(id, trip?.youAccount ?? undefined, () => {
    // Something in the queue reached the server, so the trip on screen is now behind.
    Promise.resolve().then(() => loadTrip());
  });

  const view = useMemo(() => (trip ? mergePending(trip, pending) : null), [trip, pending]);

  const visibleExpenses = useMemo(
    () => (view ? filterExpenses(view.expenses, filters) : []),
    [view, filters]
  );

  const categoryBreakdown = useMemo(() => {
    if (!view) return [];
    const totals: Record<string, number> = {};
    for (const e of view.expenses) totals[e.category] = (totals[e.category] || 0) + e.amountBase;
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [view]);

  const breakdownTotal = useMemo(
    () => categoryBreakdown.reduce((sum, [, v]) => sum + v, 0),
    [categoryBreakdown]
  );

  return {
    trip,
    error,
    stale,
    seeded,
    view,
    visibleExpenses,
    categoryBreakdown,
    breakdownTotal,
    pending,
    loadTrip,
    refreshPending,
    flushPending,
  };
}
