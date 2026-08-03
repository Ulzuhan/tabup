"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  Share2,
  Plus,
  Receipt,
  Settings,
  CloudOff,
  CopyPlus,
  Trash2,
  TriangleAlert,
  UserPlus,
  Wallet,
} from "lucide-react";
import type { Member, Expense, Payment } from "@/lib/types";
import { rememberTrip } from "@/lib/local-trips";
import { cn } from "@/lib/utils";
import { CategoryBadge, CategoryIcon, categoryTint, useCategoryName } from "@/components/category-icon";
import { MemberAvatar, MemberStack } from "@/components/member-avatar";
import { Money, currencySymbol, formatAmount } from "@/components/money";
import { ExpenseDialog, type ExpenseDraft } from "@/components/trip/expense-dialog";
import { SettleDialog, type PaymentDraft } from "@/components/trip/settle-dialog";
import { ShareDialog } from "@/components/trip/share-dialog";
import { ManageDialog } from "@/components/trip/manage-dialog";
import { SpendingPace } from "@/components/trip/spending-pace";
import {
  ExpenseFilterBar,
  NO_FILTERS,
  filterExpenses,
  type ExpenseFilters,
} from "@/components/trip/expense-filter";
import { OfflineBanner } from "@/components/offline";
import { enqueue, newClientId } from "@/lib/write-queue";
import { usePendingWrites, mergePending } from "@/lib/use-pending";
import { useT, useIntlLocale, usePlural } from "@/i18n/provider";
import { LanguageItems } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface EnrichedSettlement {
  from: string;
  to: string;
  amount: number;
  fromName: string;
  fromEmoji: string;
  toName: string;
  toEmoji: string;
}

interface EnrichedBalance {
  memberId: string;
  totalPaid: number;
  totalShare: number;
  balance: number;
  name: string;
  emoji: string;
}

interface TripData {
  id: string;
  name: string;
  currency: string;
  createdAt: number;
  version: number;
  budget?: number | null;
  members: Member[];
  expenses: Expense[];
  payments: Payment[];
  balances: EnrichedBalance[];
  settlements: EnrichedSettlement[];
  totalExpenses: number;
  access: "viewer" | "editor" | "owner";
  anonymous: boolean;
  collaborators: { id: string; email: string; name: string; role: string }[];
}

const today = () => new Date().toISOString().split("T")[0];

const emptyExpense = (currency: string, members: Member[]): ExpenseDraft => ({
  description: "",
  amount: "",
  currency,
  paidBy: members[0]?.id ?? "",
  splitAmong: members.map((m) => m.id),
  category: "food",
  note: "",
  splitMode: "equal",
  splitValues: {},
  date: today(),
});

export default function TripPage() {
  const t = useT();
  const plural = usePlural();
  const categoryName = useCategoryName();
  const intlLocale = useIntlLocale();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [trip, setTrip] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>(emptyExpense("EUR", []));

  const [settleOpen, setSettleOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    from: "",
    to: "",
    amount: "",
    note: "",
    date: today(),
  });

  const [shareOpen, setShareOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [filters, setFilters] = useState<ExpenseFilters>(NO_FILTERS);
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<{
    type: "expense" | "payment" | "trip";
    id: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const patchExpense = (patch: Partial<ExpenseDraft>) =>
    setExpenseDraft((d) => ({ ...d, ...patch }));
  const patchPayment = (patch: Partial<PaymentDraft>) =>
    setPaymentDraft((d) => ({ ...d, ...patch }));

  const loadTrip = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${id}`);
      if (!res.ok) {
        setError(t("trip.notFound"));
        return;
      }
      const data: TripData = await res.json();
      setTrip(data);
      // The service worker sets this when it served a cached copy because the network
      // was unreachable, so the page can say the figures are not current.
      setStale(res.headers.get("X-TabUp-Offline") === "1");

      // Opening an anonymous trip by link is how someone joins it. Recording the id
      // here is what puts it on their home screen afterwards.
      if (data.anonymous) rememberTrip(data.id);

      setPaymentDraft((d) => ({
        ...d,
        from: d.from || data.members[0]?.id || "",
        to: d.to || data.members[1]?.id || "",
      }));
    } catch {
      setError(t("trip.notFound"));
    }
  }, [id, t]);

  // Wrapped in a promise callback so nothing updates state during the render pass:
  // every setState inside loadTrip runs after the fetch has resolved.
  useEffect(() => {
    Promise.resolve().then(loadTrip);
  }, [loadTrip]);

  const { pending, refresh: refreshPending, flush: flushPending } = usePendingWrites(id, () => {
    // Something in the queue reached the server, so the trip on screen is now behind.
    Promise.resolve().then(() => loadTrip());
  });


  /**
   * What the screen shows: the server's data with the queued writes folded in.
   *
   * Balances come out of the merged set, computed with the same functions the server
   * uses, so typing an expense with no signal moves the figures immediately. Showing
   * the expense but leaving the balances behind would be worse than useless.
   */
  const view = useMemo(
    () => (trip ? mergePending(trip, pending) : null),
    [trip, pending]
  );

  const visibleExpenses = useMemo(
    () => (view ? filterExpenses(view.expenses, filters) : []),
    [view, filters]
  );

  const categoryBreakdown = useMemo(() => {
    if (!view) return [];
    const totals: Record<string, number> = {};
    for (const e of view.expenses) totals[e.category] = (totals[e.category] || 0) + e.amountEur;
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [view]);

  const breakdownTotal = useMemo(
    () => categoryBreakdown.reduce((sum, [, v]) => sum + v, 0),
    [categoryBreakdown]
  );

  const submitExpense = async () => {
    if (!trip) return;
    setBusy(true);

    // Percentages and exact amounts are both proportions, which is exactly what the
    // server stores, so neither mode needs converting — only the labelling differs.
    const shares: Record<string, number> = {};
    if (expenseDraft.splitMode !== "equal") {
      for (const mid of expenseDraft.splitAmong) {
        const value = parseFloat(expenseDraft.splitValues[mid] ?? "");
        if (value > 0) shares[mid] = value;
      }
    }

    // Built outside the try so the offline path can queue exactly what was going to be
    // sent, rather than reconstructing it and risking a difference.
    const body = {
        expenseId: editingId ?? undefined,
        description: expenseDraft.description.trim(),
        amount: parseFloat(expenseDraft.amount),
        currency: expenseDraft.currency,
        paidBy: expenseDraft.paidBy,
        splitAmong: expenseDraft.splitAmong,
        category: expenseDraft.category,
        note: expenseDraft.note.trim() || undefined,
        receipt: expenseDraft.receipt,
        splitShares:
          expenseDraft.splitMode !== "equal" && Object.keys(shares).length > 0
            ? shares
            : undefined,
        date: expenseDraft.date ? new Date(expenseDraft.date).getTime() : Date.now(),
    };

    try {
      const res = await fetch(`/api/trips/${id}/expense`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, clientId: editingId ? undefined : newClientId() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t("expense.saveFailed"));
        return;
      }

      setExpenseOpen(false);
      setEditingId(null);
      await loadTrip();
      toast.success(editingId ? t("expense.updated") : t("expense.added"));
    } catch {
      // The request never reached the server. A new expense can wait in the queue and
      // be delivered later; an edit cannot, because by the time it is sent the thing it
      // edits may have moved on, and guessing there would be worse than refusing.
      if (editingId) {
        toast.error(t("common.serverUnreachable"));
        return;
      }

      await enqueue({
        clientId: newClientId(),
        tripId: id,
        kind: "expense",
        body,
        createdAt: Date.now(),
      });
      setExpenseOpen(false);
      await refreshPending();
      toast.success(t("offline.queued"));
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async () => {
    setBusy(true);
    const paymentBody = {
      from: paymentDraft.from,
      to: paymentDraft.to,
      amount: parseFloat(paymentDraft.amount),
      note: paymentDraft.note.trim() || undefined,
      date: paymentDraft.date ? new Date(paymentDraft.date).getTime() : Date.now(),
    };
    try {
      const res = await fetch(`/api/trips/${id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...paymentBody, clientId: newClientId() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t("settle.failed"));
        return;
      }

      setSettleOpen(false);
      setPaymentDraft((d) => ({ ...d, amount: "", note: "" }));
      await loadTrip();
      toast.success(t("settle.recorded"));
    } catch {
      await enqueue({
        clientId: newClientId(),
        tripId: id,
        kind: "payment",
        body: paymentBody,
        createdAt: Date.now(),
      });
      setSettleOpen(false);
      setPaymentDraft((d) => ({ ...d, amount: "", note: "" }));
      await refreshPending();
      toast.success(t("offline.queued"));
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      if (confirm.type === "trip") {
        const res = await fetch(`/api/trips/${id}`, { method: "DELETE" });
        if (res.ok) {
          router.push("/");
          return;
        }
        toast.error(t("trip.deleteTrip"));
      } else {
        // Captured before the request: once it is gone from the server there is nothing
        // left to rebuild it from.
        const removed =
          confirm.type === "expense"
            ? trip?.expenses.find((e) => e.id === confirm.id)
            : undefined;
        const endpoint = confirm.type === "expense" ? "expense" : "payment";
        const key = confirm.type === "expense" ? "expenseId" : "paymentId";
        const res = await fetch(`/api/trips/${id}/${endpoint}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: confirm.id }),
        });
        if (!res.ok) {
          toast.error(t("common.somethingWrong"));
        } else {
          await loadTrip();

          // Deleting is the one destructive action people take by accident, and a
          // confirmation dialog does not help when the mistake is picking the wrong
          // row. Re-sending the same expense is enough to put it back.
          if (confirm.type === "expense" && removed) {
            toast.success(t("expense.deleted"), {
              action: {
                label: t("expense.undo"),
                onClick: async () => {
                  await fetch(`/api/trips/${id}/expense`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      description: removed.description,
                      amount: removed.amount,
                      currency: removed.currency,
                      paidBy: removed.paidBy,
                      splitAmong: removed.splitAmong,
                      splitShares: removed.splitShares,
                      category: removed.category,
                      note: removed.note,
                      date: removed.date,
                      clientId: newClientId(),
                    }),
                  }).catch(() => {});
                  await loadTrip();
                  toast.success(t("expense.restored"));
                },
              },
            });
          } else {
            toast.success(confirm.type === "expense" ? t("expense.deleted") : t("settle.deleted"));
          }
        }
      }
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setDeleting(false);
      setConfirm(null);
    }
  };

  const openNewExpense = () => {
    if (!trip) return;
    setEditingId(null);
    setExpenseDraft(emptyExpense(trip.currency, trip.members));
    setExpenseOpen(true);
  };

  /**
   * Opens a copy of an expense, dated today and not yet saved.
   *
   * "Another coffee" is the single most repeated action on a trip, and retyping the
   * same four fields for it is the kind of friction that makes people stop bothering.
   */
  const duplicateExpense = (expense: Expense) => {
    setEditingId(null);
    setExpenseDraft({
      description: expense.description,
      amount: String(expense.amount),
      currency: expense.currency,
      paidBy: expense.paidBy,
      splitAmong: [...expense.splitAmong],
      category: expense.category,
      note: expense.note ?? "",
      receipt: expense.receipt,
      splitMode: expense.splitShares ? "percent" : "equal",
      splitValues: normaliseToPercent(expense.splitShares),
      date: today(),
    });
    setExpenseOpen(true);
    toast.info(t("expense.duplicated"));
  };

  const openEditExpense = (expense: Expense) => {
    setEditingId(expense.id);
    setExpenseDraft({
      description: expense.description,
      amount: String(expense.amount),
      currency: expense.currency,
      paidBy: expense.paidBy,
      splitAmong: [...expense.splitAmong],
      category: expense.category,
      note: expense.note ?? "",
      receipt: expense.receipt,
      splitMode: expense.splitShares ? "percent" : "equal",
      // Stored shares are proportions on an arbitrary scale, so they are normalised to
      // percentages — the one reading that is always right, whatever scale was used.
      splitValues: normaliseToPercent(expense.splitShares),
      date: new Date(expense.date).toISOString().split("T")[0],
    });
    setExpenseOpen(true);
  };

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <TriangleAlert className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-medium">{t("trip.notFound")}</h1>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            {t("trip.notFoundHint")}
          </p>
          <Button variant="outline" className="mt-6" render={<Link href="/">{t("trip.goHome")}</Link>} />
        </div>
      </div>
    );
  }

  if (!trip) return <TripSkeleton />;

  const readOnly = trip.access === "viewer";
  const memberById = (mid: string) => trip.members.find((m) => m.id === mid);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-5 pb-20">
      {/* Header */}
      <header className="mb-6 flex items-start gap-3 pt-1">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 shrink-0 text-muted-foreground"
          render={
            <Link href="/" aria-label={t("common.back")}>
              <ArrowLeft className="size-5" />
            </Link>
          }
        />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{trip.name}</h1>
          <div className="mt-2 flex items-center gap-2.5">
            <MemberStack members={trip.members} />
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground"
                onClick={() => setManageOpen(true)}
              >
                <UserPlus className="size-3.5" />
                {t("trip.manage")}
              </Button>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setShareOpen(true)}
          aria-label={t("common.share")}
        >
          <Share2 className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="shrink-0" aria-label={t("trip.settings")}>
                <MoreVertical className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setManageOpen(true)}>
              <Settings className="size-4" />
              {t("trip.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<a href={`/api/trips/${id}/export`} download />}>
              <Download className="size-4" />
              {t("trip.exportCsv")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* The trip screen has its own header, so without this the language picker
                would only exist on the home screen. */}
            <LanguageItems />
            {trip.access === "owner" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirm({ type: "trip", id })}
                >
                  <Trash2 className="size-4" />
                  {t("trip.deleteTrip")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <OfflineBanner stale={stale} />

      {pending.length > 0 && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-warning/25 bg-warning/10 px-4 py-2.5 text-sm text-warning"
        >
          <CloudOff className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {pending.length === 1
                ? t("offline.pendingOne")
                : t("offline.pendingMany", { count: pending.length })}
            </p>
            <p className="text-xs opacity-80">{t("offline.pendingHint")}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-warning hover:text-warning"
            onClick={() => flushPending()}
          >
            {t("offline.sendNow")}
          </Button>
        </div>
      )}

      {/* Total */}
      <Card className="edge-light mb-4">
        <CardContent className="py-1 text-center">
          <p className="text-xs tracking-wider text-muted-foreground uppercase">{t("trip.totalSpent")}</p>
          <p className="mt-1.5 text-4xl font-semibold tracking-tight">
            <Money amount={view?.totalExpenses ?? trip.totalExpenses} currency={trip.currency} />
          </p>
          {trip.expenses.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground tabular">
              {t("trip.expenseCount", {
                expenses: plural("trip.nExpenses", view?.expenses.length ?? 0),
                people: plural("trip.nPeople", trip.members.length),
              })}
            </p>
          )}
        </CardContent>
      </Card>

      {readOnly && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <Eye className="size-4 shrink-0" />
          {t("trip.readOnly")}
        </div>
      )}

      {/* Balances */}
      {trip.balances.length > 0 && (view?.expenses.length ?? 0) > 0 && (
        <Card className="mb-4">
          <CardContent className="space-y-2.5">
            <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {t("trip.balances")}
            </h2>
            {(view?.balances ?? []).map((b) => {
              const member = memberById(b.memberId);
              return (
              <div key={b.memberId} className="flex items-center gap-2.5">
                <MemberAvatar emoji={member?.emoji} name={member?.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{member?.name}</span>
                <Money
                  amount={b.balance}
                  currency={trip.currency}
                  signed
                  className="text-sm font-medium"
                />
              </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <SpendingPace
        expenses={view?.expenses ?? []}
        currency={trip.currency}
        budget={trip.budget}
        startedAt={trip.createdAt}
      />

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <Card className="mb-4">
          <CardContent className="space-y-3">
            <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {t("trip.byCategory")}
            </h2>
            {categoryBreakdown.map(([catId, amount]) => {
              const pct = breakdownTotal > 0 ? (amount / breakdownTotal) * 100 : 0;
              return (
                <div key={catId} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <CategoryIcon category={catId} className={cn("size-4", categoryTint(catId))} />
                    <span className="min-w-0 flex-1 truncate">{categoryName(catId)}</span>
                    <span className="text-muted-foreground tabular">{pct.toFixed(0)}%</span>
                    <span className="w-20 text-right tabular">
                      {currencySymbol(trip.currency)}
                      {formatAmount(amount)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full bg-current transition-all", categoryTint(catId))}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="expenses" className="flex-1">
        <TabsList className="w-full">
          <TabsTrigger value="expenses" className="flex-1">
            {t("trip.expenses")}
          </TabsTrigger>
          <TabsTrigger value="settle" className="flex-1">
            {t("trip.settleUp")}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1">
            {t("trip.history")}
          </TabsTrigger>
        </TabsList>

        {/* Expenses */}
        <TabsContent value="expenses" className="mt-4 space-y-3">
          {!readOnly && (
            <Button className="h-11 w-full" onClick={openNewExpense}>
              <Plus className="size-4" />
              {t("trip.addExpense")}
            </Button>
          )}

          {/* The bar only earns its space once there is enough to sift through. */}
          {trip.expenses.length > 5 && (
            <ExpenseFilterBar
              members={trip.members}
              filters={filters}
              onChange={setFilters}
              shown={visibleExpenses.length}
              total={trip.expenses.length}
            />
          )}

          {trip.expenses.length === 0 ? (
            <EmptyPanel
              icon={<Receipt className="size-5 text-muted-foreground" />}
              title={t("trip.noExpenses")}
              hint={readOnly ? undefined : t("trip.noExpensesHint")}
            />
          ) : visibleExpenses.length === 0 ? (
            <EmptyPanel
              icon={<Receipt className="size-5 text-muted-foreground" />}
              title={t("search.noResults")}
              hint={t("search.noResultsHint")}
            />
          ) : (
            <div className="space-y-4">
              {groupByDay(visibleExpenses).map(([day, dayExpenses]) => (
                <section key={day}>
                  <div className="mb-1.5 flex items-baseline justify-between px-1">
                    <h3 className="text-xs font-medium text-muted-foreground">{formatDay(day, t, intlLocale)}</h3>
                    <span className="text-xs text-muted-foreground tabular">
                      {currencySymbol(trip.currency)}
                      {formatAmount(dayExpenses.reduce((sum, e) => sum + e.amountEur, 0))}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
              {dayExpenses
                .map((expense) => {
                  const payer = memberById(expense.paidBy);
                  const foreign = expense.currency !== trip.currency;
                  return (
                    <li
                      key={expense.id}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl border bg-card p-3",
                        "pending" in expense
                          ? "border-warning/30 bg-warning/[0.04]"
                          : "border-border"
                      )}
                    >
                      {expense.receipt ? (
                        // The photo replaces the category icon rather than sitting next
                        // to it: the row has no room for both, and a thumbnail of the
                        // actual receipt says more than the category ever did.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/trips/${id}/receipt?file=${encodeURIComponent(expense.receipt)}`}
                          alt=""
                          className="size-10 shrink-0 cursor-zoom-in rounded-xl object-cover"
                          onClick={() => setViewingReceipt(expense.receipt ?? null)}
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
                          {"pending" in expense && (
                            <CloudOff className="size-3.5 shrink-0 text-warning" />
                          )}
                          {payer?.emoji} {t("trip.paidBy", { name: payer?.name ?? "" })} ·{" "}
                          {plural("trip.ways", expense.splitAmong.length)}
                          {expense.splitShares && ` · ${t("trip.uneven")}`}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium">
                          <Money amount={expense.amount} currency={expense.currency} />
                        </p>
                        {foreign && (
                          <p className="text-xs text-muted-foreground">
                            ≈ <Money amount={expense.amountEur} currency={trip.currency} />
                          </p>
                        )}
                        {!expense.rateAvailable && expense.currency !== "EUR" && (
                          <Badge
                            variant="outline"
                            className="mt-0.5 h-4 gap-1 border-warning/30 px-1 text-[10px] text-warning"
                          >
                            <TriangleAlert className="size-2.5" />
                            {t("trip.rateWarning")}
                          </Badge>
                        )}
                      </div>

                      {!readOnly && !("pending" in expense) && (
                        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                            onClick={() => duplicateExpense(expense)}
                            aria-label={`${t("expense.duplicate")}: ${expense.description}`}
                          >
                            <CopyPlus className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                            onClick={() => openEditExpense(expense)}
                            aria-label={`${t("common.edit")}: ${expense.description}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirm({ type: "expense", id: expense.id })}
                            aria-label={`${t("common.delete")}: ${expense.description}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Settle up */}
        <TabsContent value="settle" className="mt-4 space-y-3">
          {(view?.settlements.length ?? 0) === 0 ? (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-6 py-10 text-center">
              <CheckCircle2 className="mx-auto mb-3 size-7 text-primary" />
              <p className="font-medium">{t("trip.allSettled")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("trip.allSettledHint")}</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {(view?.settlements ?? []).map((s, i) => {
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
                    currency={trip.currency}
                    className="shrink-0 text-sm font-semibold text-primary"
                  />
                </li>
                );
              })}
            </ul>
          )}

          {!readOnly && (
            <Button variant="outline" className="h-11 w-full" onClick={() => setSettleOpen(true)}>
              <Wallet className="size-4" />
              {t("trip.recordPayment")}
            </Button>
          )}
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          {(view?.expenses ? trip.payments : []).length === 0 ? (
            <EmptyPanel
              icon={<Wallet className="size-5 text-muted-foreground" />}
              title={t("trip.noPayments")}
              hint={t("trip.noPaymentsHint")}
            />
          ) : (
            <ul className="space-y-1.5">
              {[...trip.payments]
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
                        currency={trip.currency}
                        className="shrink-0 text-sm font-medium"
                      />

                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive max-sm:opacity-100"
                          onClick={() => setConfirm({ type: "payment", id: payment.id })}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        url={typeof window === "undefined" ? "" : window.location.href}
        tripName={trip.name}
        anonymous={trip.anonymous}
        summary={{
          currency: trip.currency,
          total: view?.totalExpenses ?? trip.totalExpenses,
          expenseCount: view?.expenses.length ?? 0,
          balances: (view?.balances ?? []).map((b) => ({
            name: memberById(b.memberId)?.name ?? "",
            emoji: memberById(b.memberId)?.emoji ?? "",
            balance: b.balance,
          })),
          settlements: (view?.settlements ?? []).map((s) => ({
            fromName: memberById(s.from)?.name ?? "",
            toName: memberById(s.to)?.name ?? "",
            amount: s.amount,
          })),
        }}
      />

      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        editing={Boolean(editingId)}
        members={trip.members}
        draft={expenseDraft}
        setDraft={patchExpense}
        busy={busy}
        onSubmit={submitExpense}
        tripId={id}
      />

      <SettleDialog
        open={settleOpen}
        onOpenChange={setSettleOpen}
        members={trip.members}
        currency={trip.currency}
        draft={paymentDraft}
        setDraft={patchPayment}
        busy={busy}
        onSubmit={submitPayment}
      />

      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        tripId={id}
        tripName={trip.name}
        tripBudget={trip.budget}
        currency={trip.currency}
        members={trip.members}
        collaborators={trip.collaborators}
        access={trip.access}
        anonymous={trip.anonymous}
        onChanged={loadTrip}
      />

      {/* Receipt viewer */}
      <Dialog open={Boolean(viewingReceipt)} onOpenChange={(o) => !o && setViewingReceipt(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("expense.receipt")}</DialogTitle>
          </DialogHeader>
          {viewingReceipt && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/trips/${id}/receipt?file=${encodeURIComponent(viewingReceipt)}`}
              alt={t("expense.receipt")}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === "trip"
                ? t("confirm.deleteTrip")
                : confirm?.type === "expense"
                  ? t("confirm.deleteExpense")
                  : t("confirm.deletePayment")}
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === "trip" ? t("confirm.deleteTripHint") : t("confirm.deleteHint")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-secondary">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TripSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-20">
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="mb-4 h-[104px] w-full rounded-xl" />
      <Skeleton className="mb-4 h-32 w-full rounded-xl" />
      <Separator className="my-4" />
      <div className="space-y-1.5">
        <Skeleton className="h-[62px] w-full rounded-xl" />
        <Skeleton className="h-[62px] w-full rounded-xl" />
        <Skeleton className="h-[62px] w-full rounded-xl" />
      </div>
    </div>
  );
}

/**
 * Turns stored split shares into percentages that add up to 100.
 *
 * Shares are proportions on whatever scale they were entered with — "3 and 1" and
 * "75 and 25" mean the same thing — so reopening an expense shows the share of the
 * total rather than the raw numbers somebody happened to type.
 */
function normaliseToPercent(shares?: Record<string, number>): Record<string, string> {
  if (!shares) return {};
  const entries = Object.entries(shares);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total <= 0) return {};

  const percents = entries.map(([id, v]) => [id, Math.round((v / total) * 10000) / 100] as const);

  // Rounding can leave the total at 99.99; the difference goes on the largest share,
  // where a hundredth of a percent is least visible.
  const drift = Math.round((100 - percents.reduce((s, [, p]) => s + p, 0)) * 100) / 100;
  if (drift !== 0 && percents.length > 0) {
    const biggest = percents.reduce((a, b) => (b[1] > a[1] ? b : a));
    const index = percents.findIndex(([id]) => id === biggest[0]);
    percents[index] = [biggest[0], Math.round((biggest[1] + drift) * 100) / 100];
  }

  return Object.fromEntries(percents.map(([id, p]) => [id, String(p)]));
}

/**
 * Groups expenses into days, newest first.
 *
 * A date on every row would repeat itself half a dozen times per day and add nothing;
 * a heading per day says the same thing once and gives the list a shape you can scan.
 * The day total is there because "what did Tuesday cost us" is a question people
 * actually ask on a trip.
 */
function groupByDay(expenses: Expense[]): [string, Expense[]][] {
  const days = new Map<string, Expense[]>();

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
function formatDay(key: string, t: (k: "trip.today" | "trip.yesterday") => string, locale: string): string {
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
    // The year only matters once it is not this one.
    year: date.getFullYear() === midnight.getFullYear() ? undefined : "numeric",
  });
}
