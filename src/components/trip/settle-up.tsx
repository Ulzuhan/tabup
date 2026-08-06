"use client";

import { ArrowRight, CheckCircle2, Trash2, Wallet } from "lucide-react";
import type { Member, Payment, Settlement } from "@/lib/types";
import { MemberAvatar } from "@/components/member-avatar";
import { Money } from "@/components/money";
import { useT, useIntlLocale } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { EmptyPanel } from "./empty-panel";

/**
 * Who should pay whom, and what has been paid already.
 *
 * Two tabs rather than one because they answer different questions: the first is what
 * to do next, the second is what happened. Mixing them would leave nobody able to tell
 * a suggestion from a fact.
 */
export function SettlementList({
  settlements,
  members,
  currency,
  onRecordPayment,
}: {
  settlements: Settlement[];
  members: Member[];
  currency: string;
  onRecordPayment: () => void;
}) {
  const t = useT();
  const memberById = (id: string) => members.find((m) => m.id === id);

  return (
    <>
      {settlements.length === 0 ? (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-6 py-10 text-center">
          <CheckCircle2 className="mx-auto mb-3 size-7 text-primary" />
          <p className="font-medium">{t("trip.allSettled")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("trip.allSettledHint")}</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {settlements.map((s, i) => {
            const from = memberById(s.from);
            const to = memberById(s.to);
            return (
              <li
                key={`${s.from}-${s.to}-${i}`}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-3"
              >
                <MemberAvatar emoji={from?.emoji} name={from?.name} size="sm" />
                <span className="truncate text-sm font-medium">{from?.name}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                <MemberAvatar emoji={to?.emoji} name={to?.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{to?.name}</span>
                <Money
                  amount={s.amount}
                  currency={currency}
                  className="shrink-0 text-sm font-semibold text-primary"
                />
              </li>
            );
          })}
        </ul>
      )}

      <Button variant="outline" className="h-11 w-full" onClick={onRecordPayment}>
        <Wallet className="size-4" />
        {t("trip.recordPayment")}
      </Button>
    </>
  );
}

export function PaymentHistory({
  payments,
  members,
  currency,
  onDelete,
}: {
  payments: Payment[];
  members: Member[];
  currency: string;
  onDelete: (paymentId: string) => void;
}) {
  const t = useT();
  const intlLocale = useIntlLocale();
  const memberById = (id: string) => members.find((m) => m.id === id);

  if (payments.length === 0) {
    return (
      <EmptyPanel
        icon={<Wallet className="size-5 text-muted-foreground" />}
        title={t("trip.noPayments")}
        hint={t("trip.noPaymentsHint")}
      />
    );
  }

  return (
    <ul className="space-y-1.5">
      {[...payments]
        .sort((a, b) => b.date - a.date)
        .map((payment) => {
          const from = memberById(payment.from);
          const to = memberById(payment.to);
          return (
            <li
              key={payment.id}
              className="group flex items-center gap-2.5 rounded-xl border border-border bg-card p-3"
            >
              <MemberAvatar emoji={from?.emoji} name={from?.name} size="sm" />
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              <MemberAvatar emoji={to?.emoji} name={to?.name} size="sm" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {t("trip.paidTo", { from: from?.name ?? "", to: to?.name ?? "" })}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {new Date(payment.date).toLocaleDateString(intlLocale)}
                  {payment.note && ` · ${payment.note}`}
                </p>
              </div>

              <Money
                amount={payment.amount}
                currency={currency}
                className="shrink-0 text-sm font-medium"
              />

              {/* Undoing a settle-up is rewriting what somebody says they were paid, so
                  it stays with whoever recorded it — and with the owner. */}
              {payment.mine && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive max-sm:opacity-100"
                  onClick={() => onDelete(payment.id)}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          );
        })}
    </ul>
  );
}
