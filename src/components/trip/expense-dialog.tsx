"use client";

import { Check, Loader2 } from "lucide-react";
import { CATEGORIES, CURRENCIES } from "@/lib/types";
import type { Member } from "@/lib/types";
import { CategoryIcon, useCategoryName } from "@/components/category-icon";
import { MemberAvatar } from "@/components/member-avatar";
import { currencySymbol, formatAmount } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/provider";

export type SplitMode = "equal" | "percent" | "amount";

export interface ExpenseDraft {
  description: string;
  amount: string;
  currency: string;
  paidBy: string;
  splitAmong: string[];
  category: string;
  note: string;
  splitMode: SplitMode;
  /** Per-member figure, meaning percent or currency depending on splitMode. */
  splitValues: Record<string, string>;
  date: string;
}

/**
 * Add or edit an expense.
 *
 * This lived inline on the page before, which meant the form pushed the expense list
 * off screen on a phone every time it opened. As a dialog it keeps the list in place
 * and gets a proper focus trap and escape handling for free.
 */
export function ExpenseDialog({
  open,
  onOpenChange,
  editing,
  members,
  draft,
  setDraft,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  members: Member[];
  draft: ExpenseDraft;
  setDraft: (patch: Partial<ExpenseDraft>) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const t = useT();
  const categoryName = useCategoryName();
  const valid =
    draft.description.trim().length > 0 &&
    parseFloat(draft.amount) > 0 &&
    draft.paidBy.length > 0 &&
    draft.splitAmong.length > 0 &&
    // An uneven split that does not add up would be scaled to fit by the server,
    // quietly changing what everyone owes. Better to refuse than to guess.
    splitBalanced(draft, parseFloat(draft.amount) || 0);

  const toggleSplit = (memberId: string) => {
    const inSplit = draft.splitAmong.includes(memberId);
    // Never let the last participant be removed: an expense split among nobody has no
    // meaning and the server would reject it anyway.
    if (inSplit && draft.splitAmong.length === 1) return;
    setDraft({
      splitAmong: inSplit
        ? draft.splitAmong.filter((id) => id !== memberId)
        : [...draft.splitAmong, memberId],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("expense.editTitle") : t("expense.newTitle")}</DialogTitle>
          <DialogDescription>
            {editing ? t("expense.editSubtitle") : t("expense.newSubtitle")}
          </DialogDescription>
        </DialogHeader>

        <form
          id="expense-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) onSubmit();
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="desc">{t("expense.description")}</Label>
            <Input
              id="desc"
              autoFocus
              value={draft.description}
              onChange={(e) => setDraft({ description: e.target.value })}
              placeholder={t("expense.descriptionPlaceholder")}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">{t("expense.amount")}</Label>
            <div className="flex gap-2">
              <Input
                id="amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft.amount}
                onChange={(e) => setDraft({ amount: e.target.value })}
                placeholder="0.00"
                className="tabular h-11 flex-1 text-base"
              />
              <Select
                value={draft.currency}
                onValueChange={(v) => setDraft({ currency: String(v) })}
              >
                <SelectTrigger className="h-11 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.symbol} {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("expense.category")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setDraft({ category: cat.id })}
                  aria-pressed={draft.category === cat.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    draft.category === cat.id
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <CategoryIcon category={cat.id} className="size-3.5" />
                  {categoryName(cat.id)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-note">
              {t("expense.note")}{" "}
              <span className="font-normal text-muted-foreground">({t("settle.optional")})</span>
            </Label>
            <Input
              id="expense-note"
              value={draft.note}
              onChange={(e) => setDraft({ note: e.target.value })}
              placeholder={t("expense.notePlaceholder")}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">{t("expense.date")}</Label>
            <Input
              id="date"
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ date: e.target.value })}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("expense.paidBy")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDraft({ paidBy: m.id })}
                  aria-pressed={draft.paidBy === m.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border py-1 pr-2.5 pl-1 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    draft.paidBy === m.id
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MemberAvatar emoji={m.emoji} size="sm" />
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          <SplitEditor
            members={members}
            draft={draft}
            setDraft={setDraft}
            total={parseFloat(draft.amount) || 0}
            currency={draft.currency}
            toggleSplit={toggleSplit}
          />
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="expense-form" disabled={!valid || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : editing ? t("common.save") : t("trip.addExpense")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rounds to cents without the floating point drift of toFixed on sums. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Whether an uneven split adds up: percentages to 100, amounts to the expense total.
 *
 * Shared by the submit button and the running total under the member list so the form
 * cannot disagree with itself about whether it is ready.
 */
export function splitBalanced(draft: ExpenseDraft, total: number): boolean {
  if (draft.splitMode === "equal") return true;
  const sum = draft.splitAmong.reduce(
    (acc, id) => acc + (parseFloat(draft.splitValues[id] ?? "") || 0),
    0
  );
  const target = draft.splitMode === "amount" ? total : 100;
  return Math.abs(round2(sum - target)) < 0.005;
}

/**
 * Splits an expense unevenly.
 *
 * Weights used to be the only option here — "1 and 1", which is 50/50 but says so to
 * nobody. Percent and exact amount are the two ways people actually describe a split,
 * and each row shows what it comes to in money, which is the number they wanted in the
 * first place.
 *
 * The server stores a proportion per member either way, so both modes map onto the same
 * field: percentages are proportions already, and amounts are proportions of the total.
 * That equivalence is also the trap — amounts that do not add up to the total would be
 * scaled to fit and silently change what everyone owes, so they have to add up before
 * the form will submit.
 */
function SplitEditor({
  members,
  draft,
  setDraft,
  total,
  currency,
  toggleSplit,
}: {
  members: Member[];
  draft: ExpenseDraft;
  setDraft: (patch: Partial<ExpenseDraft>) => void;
  total: number;
  currency: string;
  toggleSplit: (id: string) => void;
}) {
  const t = useT();
  const included = members.filter((m) => draft.splitAmong.includes(m.id));

  const valueOf = (id: string) => parseFloat(draft.splitValues[id] ?? "") || 0;
  const sum = included.reduce((acc, m) => acc + valueOf(m.id), 0);

  /** What each member ends up paying, in the trip's currency. */
  const share = (id: string): number => {
    if (draft.splitMode === "equal") return included.length ? total / included.length : 0;
    if (draft.splitMode === "amount") return valueOf(id);
    return (total * valueOf(id)) / 100;
  };

  const target = draft.splitMode === "amount" ? total : 100;
  const off = round2(sum - target);
  const balanced = Math.abs(off) < 0.005;

  /**
   * Switching modes keeps the split rather than resetting it: someone who typed 70/30
   * and then wants to see it in euros should not have to type it again.
   */
  const changeMode = (mode: SplitMode) => {
    if (mode === draft.splitMode) return;
    if (mode === "equal") {
      setDraft({ splitMode: "equal", splitValues: {} });
      return;
    }

    const values: Record<string, string> = {};
    for (const m of included) {
      const current = share(m.id);
      const next = mode === "amount" ? current : total > 0 ? (current / total) * 100 : 0;
      values[m.id] = String(round2(next));
    }
    setDraft({ splitMode: mode, splitValues: values });
  };

  /**
   * Puts whatever is missing on one member, so the last row does not need mental
   * arithmetic. Clamped at zero: when the others already add up to more than the whole
   * expense, the fix is to lower one of theirs, not to give this one a negative share.
   */
  const giveRemainder = (id: string) => {
    const corrected = Math.max(0, round2(valueOf(id) - off));
    setDraft({ splitValues: { ...draft.splitValues, [id]: String(corrected) } });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t("expense.splitAmong")}</Label>
        <div className="flex gap-0.5 rounded-lg bg-secondary p-0.5">
          {([
            ["equal", t("expense.equal")],
            ["percent", "%"],
            ["amount", currencySymbol(currency)],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => changeMode(mode)}
              className={cn(
                "min-w-9 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                draft.splitMode === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {members.map((m) => {
          const inSplit = draft.splitAmong.includes(m.id);
          return (
            <div
              key={m.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border p-1.5 transition-colors",
                inSplit ? "border-border bg-secondary/40" : "border-transparent opacity-45"
              )}
            >
              <button
                type="button"
                onClick={() => toggleSplit(m.id)}
                aria-pressed={inSplit}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MemberAvatar emoji={m.emoji} size="sm" />
                <span className="truncate text-sm">{m.name}</span>
              </button>

              {inSplit && draft.splitMode !== "equal" && (
                <div className="flex shrink-0 items-center gap-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={draft.splitMode === "amount" ? "0.01" : "1"}
                    aria-label={
                      draft.splitMode === "amount"
                        ? `${t("expense.amount")}: ${m.name}`
                        : `%: ${m.name}`
                    }
                    value={draft.splitValues[m.id] ?? ""}
                    onChange={(e) =>
                      setDraft({ splitValues: { ...draft.splitValues, [m.id]: e.target.value } })
                    }
                    className="tabular h-8 w-20 text-right"
                  />
                  <span className="w-4 text-xs text-muted-foreground">
                    {draft.splitMode === "percent" ? "%" : currencySymbol(currency)}
                  </span>
                </div>
              )}

              {/* The point of all this: what it actually costs them. */}
              {inSplit && (
                <span className="w-20 shrink-0 text-right text-sm text-muted-foreground tabular">
                  {total > 0 ? `${currencySymbol(currency)}${formatAmount(share(m.id))}` : "—"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {draft.splitMode !== "equal" && (
        <div className="flex items-center justify-between gap-2 px-1.5 text-xs">
          <span className={cn("tabular", balanced ? "text-muted-foreground" : "text-warning")}>
            {draft.splitMode === "percent"
              ? t("expense.ofHundred", { sum: round2(sum) })
              : t("expense.ofTotal", {
                  sum: `${currencySymbol(currency)}${formatAmount(sum)}`,
                  total: `${currencySymbol(currency)}${formatAmount(total)}`,
                })}
          </span>

          {balanced ? (
            <span className="flex items-center gap-1 text-primary">
              <Check className="size-3.5" />
              {t("expense.addsUp")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => giveRemainder(included[included.length - 1]?.id)}
              disabled={included.length === 0}
              className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(off > 0 ? "expense.overBy" : "expense.shortBy", {
                amount:
                  draft.splitMode === "percent"
                    ? `${Math.abs(off)}%`
                    : `${currencySymbol(currency)}${formatAmount(Math.abs(off))}`,
              })}
              {` — ${t("expense.fix")}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
