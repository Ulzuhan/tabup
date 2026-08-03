"use client";

import { Loader2 } from "lucide-react";
import { CATEGORIES, CURRENCIES } from "@/lib/types";
import { PERIODS } from "@/lib/recurring";
import { useT, useIntlLocale } from "@/i18n/provider";
import { CategoryIcon, useCategoryName } from "@/components/category-icon";
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

export interface RecurringDraft {
  name: string;
  amount: string;
  currency: string;
  period: string;
  chargeDay: string;
  chargeMonth: string;
  category: string;
  startedAt: string;
  endedAt: string;
  note: string;
}

export const emptyRecurring = (): RecurringDraft => ({
  name: "",
  amount: "",
  currency: "EUR",
  period: "monthly",
  chargeDay: "1",
  chargeMonth: "1",
  category: "other",
  startedAt: new Date().toISOString().split("T")[0],
  endedAt: "",
  note: "",
});

export function RecurringDialog({
  open,
  onOpenChange,
  editing,
  draft,
  setDraft,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  draft: RecurringDraft;
  setDraft: (patch: Partial<RecurringDraft>) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const categoryName = useCategoryName();

  const valid = draft.name.trim().length > 0 && parseFloat(draft.amount) > 0;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthName = (m: number) =>
    new Date(2026, m - 1, 1).toLocaleDateString(locale, { month: "long" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t("recurring.edit") : t("recurring.add")}</DialogTitle>
          <DialogDescription>{t("recurring.subtitle")}</DialogDescription>
        </DialogHeader>

        <form
          id="recurring-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) onSubmit();
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="rec-name">{t("recurring.name")}</Label>
            <Input
              id="rec-name"
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ name: e.target.value })}
              placeholder={t("recurring.namePlaceholder")}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rec-amount">{t("recurring.amount")}</Label>
            <div className="flex gap-2">
              <Input
                id="rec-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft.amount}
                onChange={(e) => setDraft({ amount: e.target.value })}
                placeholder="0.00"
                className="tabular h-11 flex-1 text-base"
              />
              <Select value={draft.currency} onValueChange={(v) => setDraft({ currency: String(v) })}>
                <SelectTrigger className="h-11 w-28">
                  <SelectValue>
                    {(value) => {
                      const c = CURRENCIES.find((x) => x.code === value);
                      return c ? `${c.symbol} ${c.code}` : String(value ?? "");
                    }}
                  </SelectValue>
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
            <Label>{t("recurring.period")}</Label>
            <div className="flex gap-0.5 rounded-lg bg-secondary p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDraft({ period: p })}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    draft.period === p
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`recurring.${p}` as "recurring.monthly")}
                </button>
              ))}
            </div>
          </div>

          {/* A weekly charge has no calendar day to pin it to; it repeats from the start
              date, so asking for one would be a field that does nothing. */}
          {draft.period !== "weekly" && (
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="rec-day">{t("recurring.chargeDay")}</Label>
                <Input
                  id="rec-day"
                  type="number"
                  min="1"
                  max="31"
                  value={draft.chargeDay}
                  onChange={(e) => setDraft({ chargeDay: e.target.value })}
                  className="tabular h-11"
                />
              </div>

              {draft.period === "yearly" && (
                <div className="flex-1 space-y-2">
                  <Label htmlFor="rec-month">{t("recurring.chargeMonth")}</Label>
                  <Select
                    value={draft.chargeMonth}
                    onValueChange={(v) => setDraft({ chargeMonth: String(v) })}
                  >
                    <SelectTrigger id="rec-month" className="h-11 w-full">
                      {/* Otherwise this reads "3" instead of "marzo". */}
                      <SelectValue>
                        {(value) => monthName(Number(value) || 1)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {monthName(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

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

          <div className="flex gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="rec-start">{t("recurring.started")}</Label>
              <Input
                id="rec-start"
                type="date"
                value={draft.startedAt}
                onChange={(e) => setDraft({ startedAt: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="rec-end">{t("recurring.ended")}</Label>
              <Input
                id="rec-end"
                type="date"
                value={draft.endedAt}
                onChange={(e) => setDraft({ endedAt: e.target.value })}
                placeholder={t("recurring.stillActive")}
                className="h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rec-note">
              {t("expense.note")}{" "}
              <span className="font-normal text-muted-foreground">({t("settle.optional")})</span>
            </Label>
            <Input
              id="rec-note"
              value={draft.note}
              onChange={(e) => setDraft({ note: e.target.value })}
              className="h-11"
            />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="recurring-form" disabled={!valid || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
