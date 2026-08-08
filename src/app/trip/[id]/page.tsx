"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import type { Expense, Member } from "@/lib/types";
import { ExpenseDialog, type ExpenseDraft } from "@/components/trip/expense-dialog";
import { SettleDialog, type PaymentDraft } from "@/components/trip/settle-dialog";
import { ShareDialog } from "@/components/trip/share-dialog";
import { ClaimPrompt } from "@/components/trip/claim-prompt";
import { ActivityFeed } from "@/components/trip/activity-feed";
import { CommentsDialog } from "@/components/trip/comments-dialog";
import { ManageDialog } from "@/components/trip/manage-dialog";
import { SpendingPace } from "@/components/trip/spending-pace";
import { TripHeader } from "@/components/trip/trip-header";
import {
  BalancesCard,
  CategoryBreakdown,
  PendingBanner,
  TripTotal,
} from "@/components/trip/overview";
import { ExpenseList } from "@/components/trip/expense-list";
import { PaymentHistory, SettlementList } from "@/components/trip/settle-up";
import { useTripData } from "@/components/trip/use-trip-data";
import {
  ExpenseFilterBar,
  NO_FILTERS,
  type ExpenseFilters,
} from "@/components/trip/expense-filter";
import { OfflineBanner } from "@/components/offline";
import { enqueue, newClientId } from "@/lib/write-queue";
import { stuckCount } from "@/lib/use-pending";
import { useT } from "@/i18n/provider";
import { useCategoryName } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
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

/**
 * One trip.
 *
 * This page owns the state and the writes — loading, the drafts, what a button press
 * sends, and what happens when it cannot be sent — and hands the drawing to the
 * components under components/trip. It used to draw all of it as well, which came to
 * some twelve hundred lines and twenty-two hooks in a single function, and every one of
 * the hook-order bugs this app has had came out of that.
 */

const today = () => new Date().toISOString().split("T")[0];

/**
 * `you` rather than the first member in the list.
 *
 * Whoever is typing is usually whoever paid — they are the one holding the phone — and
 * defaulting to the top of the list meant the commonest case needed a correction every
 * single time. Falls back to the first member for a reader who is in nobody's split yet.
 */
const emptyExpense = (currency: string, members: Member[], you: string | null): ExpenseDraft => ({
  description: "",
  amount: "",
  currency,
  paidBy: you ?? members[0]?.id ?? "",
  splitAmong: members.map((m) => m.id),
  category: "food",
  note: "",
  splitMode: "equal",
  splitValues: {},
  date: today(),
});

export default function TripPage() {
  const t = useT();
  const categoryName = useCategoryName();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<ExpenseFilters>(NO_FILTERS);

  const {
    trip,
    error,
    stale,
    seeded,
    view,
    visibleExpenses,
    categoryBreakdown,
    breakdownTotal,
    pending,
    loadTrip,
    refreshPending,
    flushPending,
  } = useTripData(id, filters);

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>(emptyExpense("EUR", [], null));

  const [settleOpen, setSettleOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    from: "",
    to: "",
    amount: "",
    currency: "",
    note: "",
    date: today(),
  });

  const [shareOpen, setShareOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
  /** The expense whose comments are open, if any. */
  const [commenting, setCommenting] = useState<Expense | null>(null);

  const [confirm, setConfirm] = useState<{
    type: "expense" | "payment" | "trip";
    id: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const patchExpense = (patch: Partial<ExpenseDraft>) =>
    setExpenseDraft((d) => ({ ...d, ...patch }));
  const patchPayment = (patch: Partial<PaymentDraft>) =>
    setPaymentDraft((d) => ({ ...d, ...patch }));

  /**
   * Opens the payment dialog with the first two members already picked.
   *
   * Seeded on opening rather than when the trip loads: an effect that writes state the
   * moment data arrives is a render pass nobody asked for, and this is the only moment
   * the value is actually needed.
   */
  const openSettle = () => {
    if (seeded) {
      setPaymentDraft((d) => ({
        ...d,
        from: d.from || seeded.from,
        to: d.to || seeded.to,
        currency: d.currency || trip?.currency || "EUR",
      }));
    }
    setSettleOpen(true);
  };

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
        // Named after its category when nobody typed a name, which is what people
        // would have typed anyway — and is the difference between asking for a
        // description and demanding one.
        description: expenseDraft.description.trim() || categoryName(expenseDraft.category),
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
        userId: trip.youAccount ?? undefined,
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
      currency: paymentDraft.currency || trip?.currency,
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
        userId: trip?.youAccount ?? undefined,
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
    setExpenseDraft(emptyExpense(trip.currency, trip.members, trip.you));
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

  // Everyone in a trip adds expenses; what is not everyone's is changing a figure
  // somebody else entered, and that is decided per row rather than per person.
  const owner = trip.access === "owner";
  const memberById = (mid: string) => trip.members.find((m) => m.id === mid);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-5 pb-20">
      <TripHeader
        tripId={id}
        name={trip.name}
        members={trip.members}
        access={trip.access}
        onManage={() => setManageOpen(true)}
        onShare={() => setShareOpen(true)}
        onDelete={() => setConfirm({ type: "trip", id })}
      />

      <OfflineBanner stale={stale} />
      <PendingBanner
        count={pending.length}
        stuck={stuckCount(pending)}
        onFlush={() => flushPending()}
      />

      {/* Asked once, near the top, because until it is answered every figure below is a
          list of other people's names rather than what you owe. */}
      {trip.you === null && (
        <ClaimPrompt tripId={id} candidates={trip.unclaimed} onClaimed={loadTrip} />
      )}

      <TripTotal
        total={view?.totalExpenses ?? trip.totalExpenses}
        currency={trip.currency}
        expenseCount={view?.expenses.length ?? 0}
        memberCount={trip.members.length}
        // From the merged view, so an expense typed with no signal moves it straight
        // away. Null until they have said which participant they are.
        yourBalance={
          trip.you
            ? (view?.balances ?? []).find((b) => b.memberId === trip.you)?.balance ?? 0
            : null
        }
      />

      {(view?.expenses.length ?? 0) > 0 && (
        <BalancesCard
          balances={view?.balances ?? []}
          members={trip.members}
          currency={trip.currency}
        />
      )}

      <SpendingPace
        expenses={view?.expenses ?? []}
        currency={trip.currency}
        budget={trip.budget}
        startedAt={trip.createdAt}
      />

      <CategoryBreakdown
        breakdown={categoryBreakdown}
        total={breakdownTotal}
        currency={trip.currency}
      />

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
          <TabsTrigger value="activity" className="flex-1">
            {t("trip.activity")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-4 space-y-3">
          <Button className="h-11 w-full" onClick={openNewExpense}>
            <Plus className="size-4" />
            {t("trip.addExpense")}
          </Button>

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

          <ExpenseList
            tripId={id}
            expenses={visibleExpenses}
            members={trip.members}
            currency={trip.currency}
            totalCount={trip.expenses.length}
            onEdit={openEditExpense}
            onDuplicate={duplicateExpense}
            onComment={setCommenting}
            onDelete={(expenseId) => setConfirm({ type: "expense", id: expenseId })}
            onViewReceipt={setViewingReceipt}
          />
        </TabsContent>

        <TabsContent value="settle" className="mt-4 space-y-3">
          <SettlementList
            settlements={view?.settlements ?? []}
            members={trip.members}
            currency={trip.currency}
            onRecordPayment={openSettle}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <PaymentHistory
            payments={trip.payments}
            members={trip.members}
            currency={trip.currency}
            onDelete={(paymentId) => setConfirm({ type: "payment", id: paymentId })}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          {/* Keyed on the trip's version so it refetches after anything is written,
              rather than showing a feed that stops at whatever was true on arrival. */}
          <ActivityFeed key={trip.version} tripId={id} />
        </TabsContent>
      </Tabs>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        url={typeof window === "undefined" ? "" : window.location.href}
        tripId={id}
        tripName={trip.name}
        canInvite={owner}
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

      <CommentsDialog
        open={commenting !== null}
        onOpenChange={(open) => !open && setCommenting(null)}
        tripId={id}
        expense={commenting}
        onChanged={loadTrip}
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
        access={trip.access}
        you={trip.you}
        onChanged={loadTrip}
      />

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
