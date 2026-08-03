"use client";

import { ArrowDown, Loader2 } from "lucide-react";
import type { Member } from "@/lib/types";
import { MemberAvatar } from "@/components/member-avatar";
import { currencySymbol } from "@/components/money";
import { useT } from "@/i18n/provider";
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

export interface PaymentDraft {
  from: string;
  to: string;
  amount: string;
  note: string;
  date: string;
}

/** Records that one member actually paid another back. */
export function SettleDialog({
  open,
  onOpenChange,
  members,
  currency,
  draft,
  setDraft,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  currency: string;
  draft: PaymentDraft;
  setDraft: (patch: Partial<PaymentDraft>) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const t = useT();
  const sameMember = draft.from === draft.to;
  const valid = draft.from && draft.to && !sameMember && parseFloat(draft.amount) > 0;

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "";

  /**
   * Every member in both lists.
   *
   * They used to exclude whoever was picked in the other field, which sounds tidy and
   * makes the form unusable: with two people the "from" list held a single name, so
   * swapping who paid whom was impossible.
   */
  const memberOptions = members.map((m) => (
    <SelectItem key={m.id} value={m.id}>
      <span className="flex items-center gap-2">
        <MemberAvatar emoji={m.emoji} size="sm" />
        {m.name}
      </span>
    </SelectItem>
  ));

  /** Picking the person already in the other field swaps them, rather than refusing. */
  const setFrom = (id: string) =>
    setDraft(id === draft.to ? { from: id, to: draft.from } : { from: id });
  const setTo = (id: string) =>
    setDraft(id === draft.from ? { to: id, from: draft.to } : { to: id });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settle.title")}</DialogTitle>
          <DialogDescription>
            {t("settle.subtitle", { currency })}
          </DialogDescription>
        </DialogHeader>

        <form
          id="settle-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) onSubmit();
          }}
          className="space-y-5"
        >
          {/* Stacked, with the arrow between: three things side by side overflowed a
              phone, and the amounts here are what people are checking. */}
          <div className="space-y-1">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="from">{t("settle.from")}</Label>
              <Select value={draft.from} onValueChange={(v) => setFrom(String(v))}>
                <SelectTrigger id="from" className="h-11 w-full">
                  {/* SelectValue renders the raw value, which here is a member id.
                      Without this the field showed a hex string until it was opened. */}
                  <SelectValue placeholder={t("settle.whoPaid")}>
                    {(value) => nameOf(String(value ?? ""))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>{memberOptions}</SelectContent>
              </Select>
            </div>

            <div className="flex justify-center py-0.5">
              <ArrowDown className="size-4 text-muted-foreground" />
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="to">{t("settle.to")}</Label>
              <Select value={draft.to} onValueChange={(v) => setTo(String(v))}>
                <SelectTrigger id="to" className="h-11 w-full">
                  <SelectValue placeholder={t("settle.whoReceived")}>
                    {(value) => nameOf(String(value ?? ""))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>{memberOptions}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-amount">{t("settle.amount")}</Label>
            <div className="relative">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                {currencySymbol(currency)}
              </span>
              <Input
                id="settle-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft.amount}
                onChange={(e) => setDraft({ amount: e.target.value })}
                placeholder="0.00"
                className="tabular h-11 pl-8 text-base"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-date">{t("expense.date")}</Label>
            <Input
              id="settle-date"
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ date: e.target.value })}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">
              {t("settle.note")} <span className="font-normal text-muted-foreground">({t("settle.optional")})</span>
            </Label>
            <Input
              id="note"
              value={draft.note}
              onChange={(e) => setDraft({ note: e.target.value })}
              placeholder={t("settle.notePlaceholder")}
              className="h-11"
            />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="settle-form" disabled={!valid || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : t("settle.record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
