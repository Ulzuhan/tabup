"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import type { Member } from "@/lib/types";
import { MemberAvatar } from "@/components/member-avatar";
import { currencySymbol } from "@/components/money";
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
  const sameMember = draft.from === draft.to;
  const valid = draft.from && draft.to && !sameMember && parseFloat(draft.amount) > 0;

  const memberOptions = (exclude?: string) =>
    members
      .filter((m) => m.id !== exclude)
      .map((m) => (
        <SelectItem key={m.id} value={m.id}>
          <span className="flex items-center gap-2">
            <MemberAvatar emoji={m.emoji} size="sm" />
            {m.name}
          </span>
        </SelectItem>
      ));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Money that changed hands outside the app, in {currency}.
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
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="from">From</Label>
              <Select value={draft.from} onValueChange={(v) => setDraft({ from: String(v) })}>
                <SelectTrigger id="from" className="h-11 w-full">
                  <SelectValue placeholder="Who paid" />
                </SelectTrigger>
                <SelectContent>{memberOptions(draft.to)}</SelectContent>
              </Select>
            </div>

            <ArrowRight className="mb-3.5 size-4 shrink-0 text-muted-foreground" />

            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="to">To</Label>
              <Select value={draft.to} onValueChange={(v) => setDraft({ to: String(v) })}>
                <SelectTrigger id="to" className="h-11 w-full">
                  <SelectValue placeholder="Who received" />
                </SelectTrigger>
                <SelectContent>{memberOptions(draft.from)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-amount">Amount</Label>
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
            <Label htmlFor="settle-date">Date</Label>
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
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="note"
              value={draft.note}
              onChange={(e) => setDraft({ note: e.target.value })}
              placeholder="Bizum"
              className="h-11"
            />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="settle-form" disabled={!valid || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
