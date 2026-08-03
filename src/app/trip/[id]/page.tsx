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
  Trash2,
  TriangleAlert,
  UserPlus,
  Wallet,
} from "lucide-react";
import { CATEGORIES } from "@/lib/types";
import type { Member, Expense, Payment } from "@/lib/types";
import { rememberTrip } from "@/lib/local-trips";
import { cn } from "@/lib/utils";
import { CategoryBadge, CategoryIcon, categoryTint } from "@/components/category-icon";
import { MemberAvatar, MemberStack } from "@/components/member-avatar";
import { Money, currencySymbol, formatAmount } from "@/components/money";
import { ExpenseDialog, type ExpenseDraft } from "@/components/trip/expense-dialog";
import { SettleDialog, type PaymentDraft } from "@/components/trip/settle-dialog";
import { ShareDialog } from "@/components/trip/share-dialog";
import { OfflineBanner } from "@/components/offline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  splitMode: "equal",
  splitValues: {},
  date: today(),
});

export default function TripPage() {
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
  const [memberOpen, setMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
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
        setError("Trip not found");
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
      setError("Failed to load trip");
    }
  }, [id]);

  // Wrapped in a promise callback so nothing updates state during the render pass:
  // every setState inside loadTrip runs after the fetch has resolved.
  useEffect(() => {
    Promise.resolve().then(loadTrip);
  }, [loadTrip]);

  const categoryBreakdown = useMemo(() => {
    if (!trip) return [];
    const totals: Record<string, number> = {};
    for (const e of trip.expenses) totals[e.category] = (totals[e.category] || 0) + e.amountEur;
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [trip]);

  const breakdownTotal = useMemo(
    () => categoryBreakdown.reduce((sum, [, v]) => sum + v, 0),
    [categoryBreakdown]
  );

  const submitExpense = async () => {
    if (!trip) return;
    setBusy(true);
    try {
      // Percentages and exact amounts are both proportions, which is exactly what the
      // server stores, so neither mode needs converting — only the labelling differs.
      const shares: Record<string, number> = {};
      if (expenseDraft.splitMode !== "equal") {
        for (const mid of expenseDraft.splitAmong) {
          const value = parseFloat(expenseDraft.splitValues[mid] ?? "");
          if (value > 0) shares[mid] = value;
        }
      }

      const body = {
        expenseId: editingId ?? undefined,
        description: expenseDraft.description.trim(),
        amount: parseFloat(expenseDraft.amount),
        currency: expenseDraft.currency,
        paidBy: expenseDraft.paidBy,
        splitAmong: expenseDraft.splitAmong,
        category: expenseDraft.category,
        splitShares:
          expenseDraft.splitMode !== "equal" && Object.keys(shares).length > 0
            ? shares
            : undefined,
        date: expenseDraft.date ? new Date(expenseDraft.date).getTime() : Date.now(),
      };

      const res = await fetch(`/api/trips/${id}/expense`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Could not save the expense");
        return;
      }

      setExpenseOpen(false);
      setEditingId(null);
      await loadTrip();
      toast.success(editingId ? "Expense updated" : "Expense added");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: paymentDraft.from,
          to: paymentDraft.to,
          amount: parseFloat(paymentDraft.amount),
          note: paymentDraft.note.trim() || undefined,
          date: paymentDraft.date ? new Date(paymentDraft.date).getTime() : Date.now(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Could not record the payment");
        return;
      }

      setSettleOpen(false);
      setPaymentDraft((d) => ({ ...d, amount: "", note: "" }));
      await loadTrip();
      toast.success("Payment recorded");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!newMemberName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addMembers: [newMemberName.trim()] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Could not add the member");
        return;
      }
      setNewMemberName("");
      setMemberOpen(false);
      await loadTrip();
      toast.success("Member added");
    } catch {
      toast.error("Could not reach the server");
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
        toast.error("Could not delete the trip");
      } else {
        const endpoint = confirm.type === "expense" ? "expense" : "payment";
        const key = confirm.type === "expense" ? "expenseId" : "paymentId";
        const res = await fetch(`/api/trips/${id}/${endpoint}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: confirm.id }),
        });
        if (!res.ok) {
          toast.error(`Could not delete the ${confirm.type}`);
        } else {
          await loadTrip();
          toast.success(confirm.type === "expense" ? "Expense deleted" : "Payment deleted");
        }
      }
    } catch {
      toast.error("Could not reach the server");
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

  const openEditExpense = (expense: Expense) => {
    setEditingId(expense.id);
    setExpenseDraft({
      description: expense.description,
      amount: String(expense.amount),
      currency: expense.currency,
      paidBy: expense.paidBy,
      splitAmong: [...expense.splitAmong],
      category: expense.category,
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
          <h1 className="text-lg font-medium">Trip not found</h1>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            The link may be wrong, or this trip now belongs to an account.
          </p>
          <Button variant="outline" className="mt-6" render={<Link href="/">Go home</Link>} />
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
            <Link href="/" aria-label="Back to trips">
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
                onClick={() => setMemberOpen(true)}
              >
                <UserPlus className="size-3.5" />
                Add
              </Button>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setShareOpen(true)}
          aria-label="Share trip"
        >
          <Share2 className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Trip options">
                <MoreVertical className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<a href={`/api/trips/${id}/export`} download />}>
              <Download className="size-4" />
              Export CSV
            </DropdownMenuItem>
            {trip.access === "owner" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirm({ type: "trip", id })}
                >
                  <Trash2 className="size-4" />
                  Delete trip
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <OfflineBanner stale={stale} />

      {/* Total */}
      <Card className="edge-light mb-4">
        <CardContent className="py-1 text-center">
          <p className="text-xs tracking-wider text-muted-foreground uppercase">Total spent</p>
          <p className="mt-1.5 text-4xl font-semibold tracking-tight">
            <Money amount={trip.totalExpenses} currency={trip.currency} />
          </p>
          {trip.expenses.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground tabular">
              {trip.expenses.length} {trip.expenses.length === 1 ? "expense" : "expenses"} ·{" "}
              {trip.members.length} people
            </p>
          )}
        </CardContent>
      </Card>

      {readOnly && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <Eye className="size-4 shrink-0" />
          You have read-only access to this trip.
        </div>
      )}

      {/* Balances */}
      {trip.balances.length > 0 && trip.expenses.length > 0 && (
        <Card className="mb-4">
          <CardContent className="space-y-2.5">
            <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Balances
            </h2>
            {trip.balances.map((b) => (
              <div key={b.memberId} className="flex items-center gap-2.5">
                <MemberAvatar emoji={b.emoji} name={b.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                <Money
                  amount={b.balance}
                  currency={trip.currency}
                  signed
                  className="text-sm font-medium"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <Card className="mb-4">
          <CardContent className="space-y-3">
            <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              By category
            </h2>
            {categoryBreakdown.map(([catId, amount]) => {
              const cat = CATEGORIES.find((c) => c.id === catId);
              const pct = breakdownTotal > 0 ? (amount / breakdownTotal) * 100 : 0;
              return (
                <div key={catId} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <CategoryIcon category={catId} className={cn("size-4", categoryTint(catId))} />
                    <span className="min-w-0 flex-1 truncate">{cat?.name ?? catId}</span>
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
            Expenses
          </TabsTrigger>
          <TabsTrigger value="settle" className="flex-1">
            Settle up
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1">
            History
          </TabsTrigger>
        </TabsList>

        {/* Expenses */}
        <TabsContent value="expenses" className="mt-4 space-y-3">
          {!readOnly && (
            <Button className="h-11 w-full" onClick={openNewExpense}>
              <Plus className="size-4" />
              Add expense
            </Button>
          )}

          {trip.expenses.length === 0 ? (
            <EmptyPanel
              icon={<Receipt className="size-5 text-muted-foreground" />}
              title="No expenses yet"
              hint={readOnly ? undefined : "Add the first one and balances appear here."}
            />
          ) : (
            <ul className="space-y-1.5">
              {[...trip.expenses]
                .sort((a, b) => b.date - a.date)
                .map((expense) => {
                  const payer = memberById(expense.paidBy);
                  const foreign = expense.currency !== trip.currency;
                  return (
                    <li
                      key={expense.id}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                    >
                      <CategoryBadge category={expense.category} />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{expense.description}</p>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {payer?.emoji} {payer?.name} paid · {expense.splitAmong.length} way
                          {expense.splitShares && " · uneven"}
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
                            rate
                          </Badge>
                        )}
                      </div>

                      {!readOnly && (
                        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                            onClick={() => openEditExpense(expense)}
                            aria-label={`Edit ${expense.description}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirm({ type: "expense", id: expense.id })}
                            aria-label={`Delete ${expense.description}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </TabsContent>

        {/* Settle up */}
        <TabsContent value="settle" className="mt-4 space-y-3">
          {trip.settlements.length === 0 ? (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-6 py-10 text-center">
              <CheckCircle2 className="mx-auto mb-3 size-7 text-primary" />
              <p className="font-medium">All settled up</p>
              <p className="mt-1 text-sm text-muted-foreground">Nobody owes anybody.</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {trip.settlements.map((s, i) => (
                <li
                  key={`${s.from}-${s.to}-${i}`}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-3"
                >
                  <MemberAvatar emoji={s.fromEmoji} name={s.fromName} size="sm" />
                  <span className="truncate text-sm font-medium">{s.fromName}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <MemberAvatar emoji={s.toEmoji} name={s.toName} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.toName}</span>
                  <Money
                    amount={s.amount}
                    currency={trip.currency}
                    className="shrink-0 text-sm font-semibold text-primary"
                  />
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (
            <Button variant="outline" className="h-11 w-full" onClick={() => setSettleOpen(true)}>
              <Wallet className="size-4" />
              Record a payment
            </Button>
          )}
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          {trip.payments.length === 0 ? (
            <EmptyPanel
              icon={<Wallet className="size-5 text-muted-foreground" />}
              title="No payments recorded"
              hint="Payments between members show up here."
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
                          {from?.name} paid {to?.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {new Date(payment.date).toLocaleDateString("es-ES")}
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
                          aria-label="Delete payment"
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

      {/* Add member */}
      <Dialog open={memberOpen} onOpenChange={setMemberOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              They join from now on; existing expenses are untouched.
            </DialogDescription>
          </DialogHeader>
          <form
            id="member-form"
            onSubmit={(e) => {
              e.preventDefault();
              addMember();
            }}
            className="space-y-2"
          >
            <Label htmlFor="member-name">Name</Label>
            <Input
              id="member-name"
              autoFocus
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="Cris"
              className="h-11"
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="member-form"
              disabled={!newMemberName.trim() || busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === "trip" ? "Delete this trip?" : `Delete this ${confirm?.type}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === "trip"
                ? "Every expense, payment and member goes with it. This cannot be undone."
                : "This cannot be undone. Balances update immediately."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
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
