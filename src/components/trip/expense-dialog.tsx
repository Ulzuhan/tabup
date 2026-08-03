"use client";

import { Loader2 } from "lucide-react";
import { CATEGORIES, CURRENCIES } from "@/lib/types";
import type { Member } from "@/lib/types";
import { CategoryIcon } from "@/components/category-icon";
import { MemberAvatar } from "@/components/member-avatar";
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

export interface ExpenseDraft {
  description: string;
  amount: string;
  currency: string;
  paidBy: string;
  splitAmong: string[];
  category: string;
  splitMode: "equal" | "custom";
  customShares: Record<string, string>;
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
  const valid =
    draft.description.trim().length > 0 &&
    parseFloat(draft.amount) > 0 &&
    draft.paidBy.length > 0 &&
    draft.splitAmong.length > 0;

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
          <DialogTitle>{editing ? "Edit expense" : "New expense"}</DialogTitle>
          <DialogDescription>
            {editing ? "Change any field and save." : "Who paid, how much, and for whom."}
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
            <Label htmlFor="desc">Description</Label>
            <Input
              id="desc"
              autoFocus
              value={draft.description}
              onChange={(e) => setDraft({ description: e.target.value })}
              placeholder="Dinner at the port"
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
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
            <Label>Category</Label>
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
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ date: e.target.value })}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label>Paid by</Label>
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Split among</Label>
              <div className="flex gap-0.5 rounded-lg bg-secondary p-0.5">
                {(["equal", "custom"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setDraft(
                        mode === "equal"
                          ? { splitMode: "equal", customShares: {} }
                          : { splitMode: "custom" }
                      )
                    }
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                      draft.splitMode === mode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {members.map((m) => {
                const included = draft.splitAmong.includes(m.id);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-1.5 transition-colors",
                      included ? "border-border bg-secondary/40" : "border-transparent opacity-45"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSplit(m.id)}
                      aria-pressed={included}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MemberAvatar emoji={m.emoji} size="sm" />
                      <span className="truncate text-sm">{m.name}</span>
                    </button>

                    {draft.splitMode === "custom" && included && (
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.5"
                        aria-label={`Share for ${m.name}`}
                        value={draft.customShares[m.id] ?? "1"}
                        onChange={(e) =>
                          setDraft({
                            customShares: { ...draft.customShares, [m.id]: e.target.value },
                          })
                        }
                        className="tabular h-8 w-16 text-center"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {draft.splitMode === "custom" && (
              <p className="text-xs text-muted-foreground">
                Weights, not amounts: 3 and 1 means one pays three quarters.
              </p>
            )}
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" disabled={!valid || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : editing ? "Save" : "Add expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
