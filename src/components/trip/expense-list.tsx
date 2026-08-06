"use client";

import {
  CloudOff,
  CopyPlus,
  MessageCircle,
  Pencil,
  Receipt,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { Expense, Member } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/category-icon";
import { Money } from "@/components/money";
import { currencySymbol, formatAmount } from "@/components/money";
import { useT, useIntlLocale, usePlural } from "@/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyPanel } from "./empty-panel";
import type { MaybePendingExpense } from "./types";

/**
 * The expenses themselves, grouped by day.
 *
 * A queued offline expense appears in the list like any other, marked, and without its
 * edit and delete buttons: it does not exist on the server yet, so there is nothing to
 * edit and nothing to delete — only the queue, which sends itself.
 */
export function ExpenseList({
  tripId,
  expenses,
  members,
  currency,
  totalCount,
  onEdit,
  onDuplicate,
  onComment,
  onDelete,
  onViewReceipt,
}: {
  tripId: string;
  expenses: MaybePendingExpense[];
  members: Member[];
  currency: string;
  /** Everything the trip has, before filtering — tells apart "none" from "none shown". */
  totalCount: number;
  onEdit: (expense: Expense) => void;
  onDuplicate: (expense: Expense) => void;
  onComment: (expense: Expense) => void;
  onDelete: (expenseId: string) => void;
  onViewReceipt: (file: string) => void;
}) {
  const t = useT();
  const plural = usePlural();
  const intlLocale = useIntlLocale();
  const memberById = (id: string) => members.find((m) => m.id === id);

  if (totalCount === 0) {
    return (
      <EmptyPanel
        icon={<Receipt className="size-5 text-muted-foreground" />}
        title={t("trip.noExpenses")}
        hint={t("trip.noExpensesHint")}
      />
    );
  }

  if (expenses.length === 0) {
    return (
      <EmptyPanel
        icon={<Receipt className="size-5 text-muted-foreground" />}
        title={t("search.noResults")}
        hint={t("search.noResultsHint")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {groupByDay(expenses).map(([day, dayExpenses]) => (
        <section key={day}>
          <div className="mb-1.5 flex items-baseline justify-between px-1">
            <h3 className="text-xs font-medium text-muted-foreground">
              {formatDay(day, t, intlLocale)}
            </h3>
            <span className="tabular text-xs text-muted-foreground">
              {currencySymbol(currency)}
              {formatAmount(dayExpenses.reduce((sum, e) => sum + e.amountBase, 0))}
            </span>
          </div>

          <ul className="space-y-1.5">
            {dayExpenses.map((expense) => {
              const payer = memberById(expense.paidBy);
              const foreign = expense.currency !== currency;
              const queued = "pending" in expense;

              return (
                <li
                  key={expense.id}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border bg-card p-3",
                    queued ? "border-warning/30 bg-warning/[0.04]" : "border-border"
                  )}
                >
                  {expense.receipt ? (
                    // The photo replaces the category icon rather than sitting next to
                    // it: the row has no room for both, and a thumbnail of the actual
                    // receipt says more than the category ever did.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/trips/${tripId}/receipt?file=${encodeURIComponent(expense.receipt)}`}
                      alt=""
                      className="size-10 shrink-0 cursor-zoom-in rounded-xl object-cover"
                      onClick={() => expense.receipt && onViewReceipt(expense.receipt)}
                    />
                  ) : (
                    <CategoryBadge category={expense.category} />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{expense.description}</p>
                    {expense.note && (
                      <p className="truncate text-[13px] text-muted-foreground italic">
                        {expense.note}
                      </p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                      {queued && <CloudOff className="size-3.5 shrink-0 text-warning" />}
                      {payer?.emoji} {t("trip.paidBy", { name: payer?.name ?? "" })} ·{" "}
                      {plural("trip.ways", expense.splitAmong.length)}
                      {expense.splitShares && ` · ${t("trip.uneven")}`}
                      {/* Who typed it, when that is somebody other than who paid. The
                          rule about who may change it is invisible otherwise: a line
                          with no edit button says neither whose it is nor who to ask. */}
                      {expense.by && ` · ${t("trip.enteredBy", { name: expense.by })}`}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium">
                      <Money amount={expense.amount} currency={expense.currency} />
                    </p>
                    {foreign && (
                      <p className="text-xs text-muted-foreground">
                        ≈ <Money amount={expense.amountBase} currency={currency} />
                      </p>
                    )}
                    {!expense.rateAvailable && foreign && (
                      <Badge
                        variant="outline"
                        className="mt-0.5 h-4 gap-1 border-warning/30 px-1 text-[10px] text-warning"
                      >
                        <TriangleAlert className="size-2.5" />
                        {t("trip.rateWarning")}
                      </Badge>
                    )}
                  </div>

                  {!queued && (
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
                      {/* Open to everyone, and the counterweight to the edit rule: the
                          person who may not change a figure is exactly the one who needs
                          a way to say it looks wrong. Stays visible once there are any,
                          because a conversation nobody can see is not one. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "size-8 text-muted-foreground",
                          expense.comments ? "opacity-100" : ""
                        )}
                        onClick={() => onComment(expense)}
                        aria-label={`${t("comments.title")}: ${expense.description}`}
                      >
                        <MessageCircle className="size-3.5" />
                        {expense.comments ? (
                          <span className="tabular -ml-0.5 text-[11px]">{expense.comments}</span>
                        ) : null}
                      </Button>
                      {/* Duplicating is adding one of your own, which everybody in a
                          trip may do — including from somebody else's line. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        onClick={() => onDuplicate(expense)}
                        aria-label={`${t("expense.duplicate")}: ${expense.description}`}
                      >
                        <CopyPlus className="size-3.5" />
                      </Button>
                      {/* Changing one is not: it is somebody's record of their money,
                          and only they — or the owner — get to rewrite it. */}
                      {expense.mine && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                            onClick={() => onEdit(expense)}
                            aria-label={`${t("common.edit")}: ${expense.description}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => onDelete(expense.id)}
                            aria-label={`${t("common.delete")}: ${expense.description}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Groups expenses into days, newest first.
 *
 * A date on every row would repeat itself half a dozen times per day and add nothing;
 * a heading per day says the same thing once and gives the list a shape you can scan.
 * The day total is there because "what did Tuesday cost us" is a question people
 * actually ask on a trip.
 */
function groupByDay(expenses: MaybePendingExpense[]): [string, MaybePendingExpense[]][] {
  const days = new Map<string, MaybePendingExpense[]>();

  for (const expense of [...expenses].sort((a, b) => b.date - a.date)) {
    // Local date, not ISO: an expense at 01:00 in Madrid belongs to that day, and
    // toISOString would file it under the previous one.
    const date = new Date(expense.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;
    const list = days.get(key);
    if (list) list.push(expense);
    else days.set(key, [expense]);
  }

  return [...days.entries()];
}

/**
 * "Today", "Yesterday", or a written date — relative labels only where they help.
 *
 * Takes its wording and its locale as arguments rather than reaching for the hook,
 * because it is called from inside a render loop and a plain function keeps it cheap.
 */
function formatDay(
  key: string,
  t: (k: "trip.today" | "trip.yesterday") => string,
  locale: string
): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((midnight.getTime() - date.getTime()) / 86_400_000);

  if (daysAgo === 0) return t("trip.today");
  if (daysAgo === 1) return t("trip.yesterday");

  return date.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    // A year only helps once it is not this one.
    year: date.getFullYear() === midnight.getFullYear() ? undefined : "numeric",
  });
}
