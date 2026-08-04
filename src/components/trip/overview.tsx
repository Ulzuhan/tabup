"use client";

import { CloudOff, Eye } from "lucide-react";
import type { Balance, Member } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CategoryIcon, categoryTint, useCategoryName } from "@/components/category-icon";
import { MemberAvatar } from "@/components/member-avatar";
import { Money, currencySymbol, formatAmount } from "@/components/money";
import { useT, usePlural } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The band above the tabs: what the trip has cost, who is up and who is down, and where
 * the money went.
 *
 * All of it reads from the merged view — the server's data with any queued offline
 * writes folded in — so an expense added without a connection moves these figures
 * immediately rather than waiting for a sync to make it real.
 */

/** Writes still sitting in the local queue. */
export function PendingBanner({ count, onFlush }: { count: number; onFlush: () => void }) {
  const t = useT();
  if (count === 0) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl border border-warning/25 bg-warning/10 px-4 py-2.5 text-sm text-warning"
    >
      <CloudOff className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {count === 1 ? t("offline.pendingOne") : t("offline.pendingMany", { count })}
        </p>
        <p className="text-xs opacity-80">{t("offline.pendingHint")}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 text-warning hover:text-warning"
        onClick={onFlush}
      >
        {t("offline.sendNow")}
      </Button>
    </div>
  );
}

export function TripTotal({
  total,
  currency,
  expenseCount,
  memberCount,
}: {
  total: number;
  currency: string;
  expenseCount: number;
  memberCount: number;
}) {
  const t = useT();
  const plural = usePlural();

  return (
    <Card className="edge-light mb-4">
      <CardContent className="py-1 text-center">
        <p className="text-xs tracking-wider text-muted-foreground uppercase">
          {t("trip.totalSpent")}
        </p>
        <p className="mt-1.5 text-4xl font-semibold tracking-tight">
          <Money amount={total} currency={currency} />
        </p>
        {expenseCount > 0 && (
          <p className="tabular mt-1 text-sm text-muted-foreground">
            {t("trip.expenseCount", {
              expenses: plural("trip.nExpenses", expenseCount),
              people: plural("trip.nPeople", memberCount),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ReadOnlyNotice() {
  const t = useT();
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
      <Eye className="size-4 shrink-0" />
      {t("trip.readOnly")}
    </div>
  );
}

export function BalancesCard({
  balances,
  members,
  currency,
}: {
  balances: Pick<Balance, "memberId" | "balance">[];
  members: Member[];
  currency: string;
}) {
  const t = useT();
  if (balances.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardContent className="space-y-2.5">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("trip.balances")}
        </h2>
        {balances.map((b) => {
          const member = members.find((m) => m.id === b.memberId);
          return (
            <div key={b.memberId} className="flex items-center gap-2.5">
              <MemberAvatar emoji={member?.emoji} name={member?.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm">{member?.name}</span>
              <Money
                amount={b.balance}
                currency={currency}
                signed
                className="text-sm font-medium"
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function CategoryBreakdown({
  breakdown,
  total,
  currency,
}: {
  breakdown: [string, number][];
  total: number;
  currency: string;
}) {
  const t = useT();
  const categoryName = useCategoryName();
  if (breakdown.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardContent className="space-y-3">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("trip.byCategory")}
        </h2>
        {breakdown.map(([catId, amount]) => {
          const pct = total > 0 ? (amount / total) * 100 : 0;
          return (
            <div key={catId} className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <CategoryIcon category={catId} className={cn("size-4", categoryTint(catId))} />
                <span className="min-w-0 flex-1 truncate">{categoryName(catId)}</span>
                <span className="tabular text-muted-foreground">{pct.toFixed(0)}%</span>
                <span className="tabular w-20 text-right">
                  {currencySymbol(currency)}
                  {formatAmount(amount)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full bg-current transition-all",
                    categoryTint(catId)
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
