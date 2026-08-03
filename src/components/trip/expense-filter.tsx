"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { Expense, Member } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { useT } from "@/i18n/provider";
import { useCategoryName } from "@/components/category-icon";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ExpenseFilters {
  query: string;
  payer: string | null;
  category: string | null;
}

export const NO_FILTERS: ExpenseFilters = { query: "", payer: null, category: null };

export const hasFilters = (f: ExpenseFilters) =>
  f.query.trim().length > 0 || f.payer !== null || f.category !== null;

/**
 * Narrows the expense list.
 *
 * Filtering happens on the client because the whole trip is already loaded — a request
 * per keystroke would be slower and would stop working offline, which is exactly when
 * you are most likely to be hunting for "what was that thing in the market".
 */
export function filterExpenses(expenses: Expense[], f: ExpenseFilters): Expense[] {
  const query = f.query.trim().toLowerCase();

  /**
   * Amounts are shown as "23,50" in Spanish, so that is what somebody will type when
   * searching for one — but they are stored as 23.5. Treating comma and dot as the
   * same character means the search matches what is on screen.
   */
  const numeric = query.replace(",", ".");

  return expenses.filter((e) => {
    if (f.payer && e.paidBy !== f.payer) return false;
    if (f.category && e.category !== f.category) return false;
    if (!query) return true;

    // Amounts are searchable too: people remember "the forty euro one" more often than
    // they remember what they typed as the description.
    return (
      e.description.toLowerCase().includes(query) ||
      String(e.amount).includes(numeric) ||
      e.amount.toFixed(2).includes(numeric)
    );
  });
}

export function ExpenseFilterBar({
  members,
  filters,
  onChange,
  shown,
  total,
}: {
  members: Member[];
  filters: ExpenseFilters;
  onChange: (f: ExpenseFilters) => void;
  shown: number;
  total: number;
}) {
  const t = useT();
  const categoryName = useCategoryName();
  const [open, setOpen] = useState(false);

  const active = hasFilters(filters);
  const usedCategories = useMemo(() => CATEGORIES.map((c) => c.id), []);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder={t("search.placeholder")}
            className="h-10 pr-9 pl-9"
            aria-label={t("search.placeholder")}
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, query: "" })}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("search.clear")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Button
          variant={filters.payer || filters.category ? "default" : "outline"}
          size="icon"
          className="size-10 shrink-0"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("search.filters")}
          aria-expanded={open}
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </div>

      {open && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={filters.payer === null}
              onClick={() => onChange({ ...filters, payer: null })}
            >
              {t("search.anyone")}
            </FilterChip>
            {members.map((m) => (
              <FilterChip
                key={m.id}
                active={filters.payer === m.id}
                onClick={() =>
                  onChange({ ...filters, payer: filters.payer === m.id ? null : m.id })
                }
              >
                <MemberAvatar emoji={m.emoji} size="sm" />
                {m.name}
              </FilterChip>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={filters.category === null}
              onClick={() => onChange({ ...filters, category: null })}
            >
              {t("search.anyCategory")}
            </FilterChip>
            {usedCategories.map((id) => (
              <FilterChip
                key={id}
                active={filters.category === id}
                onClick={() =>
                  onChange({ ...filters, category: filters.category === id ? null : id })
                }
              >
                {categoryName(id)}
              </FilterChip>
            ))}
          </div>
        </div>
      )}

      {active && (
        <div className="flex items-center justify-between px-1 text-xs">
          <Badge variant="outline" className="h-5 px-1.5 font-normal tabular">
            {t("search.results", { count: shown, total })}
          </Badge>
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("search.clear")}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
