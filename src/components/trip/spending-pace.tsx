"use client";

import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import type { Expense } from "@/lib/types";
import { useT, useIntlLocale } from "@/i18n/provider";
import { currencySymbol, useAmountFormatter } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * How fast the money is going.
 *
 * The total alone never answered the question people actually ask halfway through a
 * trip — "are we going over?" — because a number means nothing without a rate to
 * compare it to. Daily average, a projection to the end, and a bar per day, which is
 * what shows at a glance that Saturday cost three times Tuesday.
 */
export function SpendingPace({
  expenses,
  currency,
  budget,
  startedAt,
}: {
  expenses: Expense[];
  currency: string;
  budget?: number | null;
  startedAt: number;
}) {
  const fmt = useAmountFormatter();
  const t = useT();
  const locale = useIntlLocale();

  const stats = useMemo(() => {
    if (expenses.length === 0) return null;

    const byDay = new Map<string, number>();
    for (const e of expenses) {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      byDay.set(key, (byDay.get(key) ?? 0) + e.amountBase);
    }

    const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const total = expenses.reduce((sum, e) => sum + e.amountBase, 0);

    /**
     * Elapsed days, not days with expenses.
     *
     * Dividing by the number of days that happen to have a receipt would call a trip
     * with one big day and four quiet ones far more expensive than it is.
     */
    const first = Math.min(startedAt, ...expenses.map((e) => e.date));
    const midnight = new Date();
    midnight.setHours(23, 59, 59, 999);
    const elapsed = Math.max(1, Math.ceil((midnight.getTime() - first) / 86_400_000));

    const perDay = total / elapsed;
    const peak = Math.max(...days.map(([, amount]) => amount));

    return { days, total, perDay, elapsed, peak };
  }, [expenses, startedAt]);

  if (!stats) return null;

  // Only meaningful once there is more than a single day to average over.
  const showPace = stats.elapsed > 1;
  const overBudget = budget != null && stats.total > budget;
  const budgetUsed = budget != null && budget > 0 ? (stats.total / budget) * 100 : 0;

  const dayLabel = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { day: "numeric", month: "short" });
  };

  return (
    <Card className="mb-4">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {t("pace.title")}
          </h2>
          {showPace && (
            <span className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="size-3.5 text-muted-foreground" />
              <span className="tabular font-medium">
                {currencySymbol(currency)}
                {fmt(stats.perDay)}
              </span>
              <span className="text-xs text-muted-foreground">{t("pace.perDay")}</span>
            </span>
          )}
        </div>

        {budget != null && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className={cn("tabular", overBudget && "text-destructive")}>
                {t("pace.ofBudget", {
                  used: `${currencySymbol(currency)}${fmt(stats.total)}`,
                  budget: `${currencySymbol(currency)}${fmt(budget)}`,
                })}
              </span>
              <span
                className={cn(
                  "tabular text-xs",
                  overBudget ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {Math.round(budgetUsed)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  overBudget ? "bg-destructive" : "bg-primary"
                )}
                style={{ width: `${Math.min(100, budgetUsed)}%` }}
              />
            </div>
            <p className={cn("text-xs", overBudget ? "text-destructive" : "text-muted-foreground")}>
              {overBudget
                ? t("pace.over", {
                    amount: `${currencySymbol(currency)}${fmt(stats.total - budget)}`,
                  })
                : t("pace.left", {
                    amount: `${currencySymbol(currency)}${fmt(budget - stats.total)}`,
                  })}
            </p>
          </div>
        )}

        {/* One bar per day. Heights are relative to the busiest day, so the shape of the
            trip reads immediately even when the amounts are small. */}
        {stats.days.length > 1 && (
          <div className="flex items-end gap-1 pt-1" style={{ height: "3.5rem" }}>
            {stats.days.map(([key, amount]) => (
              <div
                key={key}
                // h-full so the percentage height below has something to resolve
                // against: without it the column shrinks to its content and the bars
                // collapse to nothing.
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${dayLabel(key)} · ${currencySymbol(currency)}${fmt(amount)}`}
              >
                <div
                  className="w-full rounded-sm bg-primary/60 transition-colors group-hover:bg-primary"
                  style={{ height: `${Math.max(4, (amount / stats.peak) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        )}

        {stats.days.length > 1 && (
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{dayLabel(stats.days[0][0])}</span>
            <span>{dayLabel(stats.days[stats.days.length - 1][0])}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
