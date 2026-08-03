"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarClock, Download, Loader2, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useT, useIntlLocale } from "@/i18n/provider";
import { AppHeader, type SessionUser } from "@/components/app-header";
import { SectionTabs, SectionTabsSpacer } from "@/components/section-tabs";
import { CategoryIcon, categoryTint, useCategoryName } from "@/components/category-icon";
import { Money, currencySymbol, formatAmount } from "@/components/money";
import { RecurringDialog, type RecurringDraft, emptyRecurring } from "@/components/recurring/recurring-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  byCategory,
  chargedInMonth,
  monthlyEquivalent,
  monthlyTotal,
  upcoming,
  type Recurring,
} from "@/lib/recurring";
import { cn } from "@/lib/utils";

export default function RecurringPage() {
  const t = useT();
  const locale = useIntlLocale();
  const categoryName = useCategoryName();

  const [items, setItems] = useState<Recurring[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecurringDraft>(emptyRecurring());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Recurring | null>(null);

  const load = useCallback(async () => {
    const [session, list] = await Promise.all([
      fetch("/api/auth/me").then((r) => r.json()).catch(() => ({ user: null })),
      fetch("/api/recurring").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
    ]);
    setUser(session.user ?? null);
    setItems(list.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  const active = useMemo(() => items.filter((i) => i.endedAt == null), [items]);
  const perMonth = useMemo(() => monthlyTotal(items), [items]);
  const categories = useMemo(() => byCategory(items), [items]);
  const next30 = useMemo(() => upcoming(items, 30), [items]);
  const thisMonth = useMemo(() => {
    const now = new Date();
    return chargedInMonth(items, now.getFullYear(), now.getMonth());
  }, [items]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/recurring", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, id: editing ?? undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("common.somethingWrong"));
        return;
      }
      setOpen(false);
      setEditing(null);
      await load();
      toast.success(t("recurring.saved"));
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch("/api/recurring", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirm.id }),
      });
      if (!res.ok) {
        toast.error(t("common.somethingWrong"));
        return;
      }
      await load();
      toast.success(t("recurring.deleted"));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const openNew = () => {
    setEditing(null);
    setDraft(emptyRecurring());
    setOpen(true);
  };

  const openEdit = (item: Recurring) => {
    setEditing(item.id);
    setDraft({
      name: item.name,
      amount: String(item.amount),
      currency: item.currency,
      period: item.period,
      chargeDay: String(item.chargeDay),
      chargeMonth: item.chargeMonth ? String(item.chargeMonth) : "1",
      category: item.category,
      startedAt: new Date(item.startedAt).toISOString().split("T")[0],
      endedAt: item.endedAt ? new Date(item.endedAt).toISOString().split("T")[0] : "",
      note: item.note ?? "",
    });
    setOpen(true);
  };

  const dayLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short" });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-5 pb-16 sm:pt-8">
      <AppHeader user={user} loading={loading} onSignOut={signOut} />
      <SectionTabs current="recurring" />

      {loading ? (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : !user ? (
        /* No anonymous mode here: these are personal standing costs with nobody to
           share them with, so there is no link that could stand in for an account. */
        <div className="mt-10 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <Repeat className="size-6 text-muted-foreground" />
          </div>
          <p className="font-medium">{t("recurring.signInFirst")}</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">
            {t("recurring.signInHint")}
          </p>
          <Button className="mt-6" render={<Link href="/login">{t("auth.signIn")}</Link>} />
        </div>
      ) : (
        <>
          <Card className="edge-light mt-4 mb-4">
            <CardContent className="py-1 text-center">
              <p className="text-xs tracking-wider text-muted-foreground uppercase">
                {t("recurring.total")}
              </p>
              <p className="mt-1.5 text-4xl font-semibold tracking-tight">
                <Money amount={perMonth} currency="EUR" />
              </p>
              <p className="mt-1 text-sm text-muted-foreground tabular">
                {formatAmount(perMonth * 12)} € {t("recurring.perYear")} ·{" "}
                {t("recurring.active", { count: active.length })}
              </p>
            </CardContent>
          </Card>

          {thisMonth > 0 && (
            <Card className="mb-4">
              <CardContent className="flex items-center justify-between py-1">
                <span className="text-sm text-muted-foreground">{t("recurring.thisMonth")}</span>
                <Money amount={thisMonth} currency="EUR" className="font-medium" />
              </CardContent>
            </Card>
          )}

          {categories.length > 0 && (
            <Card className="mb-4">
              <CardContent className="space-y-3">
                <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  {t("trip.byCategory")}
                </h2>
                {categories.map(([id, amount]) => {
                  const pct = perMonth > 0 ? (amount / perMonth) * 100 : 0;
                  return (
                    <div key={id} className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <CategoryIcon category={id} className={cn("size-4", categoryTint(id))} />
                        <span className="min-w-0 flex-1 truncate">{categoryName(id)}</span>
                        <span className="text-muted-foreground tabular">{pct.toFixed(0)}%</span>
                        <span className="w-20 text-right tabular">€{formatAmount(amount)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn("h-full rounded-full bg-current", categoryTint(id))}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {next30.length > 0 && (
            <Card className="mb-4">
              <CardContent className="space-y-2">
                <h2 className="flex items-center gap-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  <CalendarClock className="size-3.5" />
                  {t("recurring.upcoming")}
                </h2>
                {next30.slice(0, 6).map(({ item, at }) => (
                  <div key={`${item.id}-${at}`} className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-muted-foreground tabular">
                      {dayLabel(at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <Money amount={item.amount} currency={item.currency} className="shrink-0" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="mb-3 flex gap-2">
            <Button className="h-11 flex-1" onClick={openNew}>
              <Plus className="size-4" />
              {t("recurring.add")}
            </Button>
            {items.length > 0 && (
              <Button
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label={t("trip.exportCsv")}
                render={<a href="/api/recurring/export" download />}
              >
                <Download className="size-4" />
              </Button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
                <Repeat className="size-6 text-muted-foreground" />
              </div>
              <p className="font-medium">{t("recurring.empty")}</p>
              <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">
                {t("recurring.emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {items.map((item) => {
                const cancelled = item.endedAt != null;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl border border-border bg-card p-3",
                      cancelled && "opacity-55"
                    )}
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                      <CategoryIcon
                        category={item.category}
                        className={cn("size-[18px]", categoryTint(item.category))}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                        {currencySymbol(item.currency)}
                        {formatAmount(item.amount)} / {t(`recurring.${item.period}`).toLowerCase()}
                        {cancelled && (
                          <Badge variant="outline" className="ml-2 h-4 px-1 text-[10px]">
                            {t("recurring.cancelled")}
                          </Badge>
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {/* A cancelled item costs nothing now, so showing its old monthly
                          figure here would read as if it still did. */}
                      {cancelled ? (
                        <p className="text-sm text-muted-foreground tabular">—</p>
                      ) : (
                        <>
                          <p className="text-sm font-medium">
                            <Money amount={monthlyEquivalent(item)} currency="EUR" />
                          </p>
                          <p className="text-xs text-muted-foreground">{t("recurring.perMonth")}</p>
                        </>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        onClick={() => openEdit(item)}
                        aria-label={`${t("common.edit")}: ${item.name}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirm(item)}
                        aria-label={`${t("common.delete")}: ${item.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <RecurringDialog
        open={open}
        onOpenChange={setOpen}
        editing={Boolean(editing)}
        draft={draft}
        setDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        busy={busy}
        onSubmit={save}
      />

      <Dialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirm?.name}</DialogTitle>
            <DialogDescription>{t("confirm.deleteHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SectionTabsSpacer />
    </div>
  );
}
