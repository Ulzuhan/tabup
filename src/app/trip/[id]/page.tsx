"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { CURRENCIES, CATEGORIES } from "@/lib/types";
import type { Member, Expense, Payment } from "@/lib/types";

interface EnrichedSettlement { from: string; to: string; amount: number; fromName: string; fromEmoji: string; toName: string; toEmoji: string }
interface EnrichedBalance { memberId: string; totalPaid: number; totalShare: number; balance: number; name: string; emoji: string }

interface TripData {
  id: string; name: string; currency: string; createdAt: number; version: number;
  members: Member[]; expenses: Expense[]; payments: Payment[];
  balances: EnrichedBalance[]; settlements: EnrichedSettlement[]; totalExpenses: number;
}

export default function TripPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [trip, setTrip] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [showEdit, setShowEdit] = useState<string | null>(null); // expense id being edited
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"expenses" | "settle" | "history">("expenses");

  // Add expense form
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [expCurrency, setExpCurrency] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  const [category, setCategory] = useState("food");
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const [customShares, setCustomShares] = useState<Record<string, string>>({});

  // Settle up form
  const [settleFrom, setSettleFrom] = useState("");
  const [settleTo, setSettleTo] = useState("");
  const [settleAmount, setSettleAmount] = useState("");
  const [settleNote, setSettleNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ type: "expense" | "payment" | "trip"; id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");

  const [expDate, setExpDate] = useState("");
  const [settleDate, setSettleDate] = useState("");

  const loadTrip = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${id}`);
      if (!res.ok) { setError("Trip not found"); return; }
      const data = await res.json();
      setTrip(data);
      if (!expCurrency) setExpCurrency(data.currency);
      if (!paidBy && data.members.length > 0) setPaidBy(data.members[0].id);
      if (splitAmong.length === 0) setSplitAmong(data.members.map((m: Member) => m.id));
      if (!settleFrom && data.members.length > 0) setSettleFrom(data.members[0].id);
      if (!settleTo && data.members.length > 1) setSettleTo(data.members[1].id);
    } catch { setError("Failed to load trip"); }
  }, [id]);

  useEffect(() => { loadTrip(); }, [loadTrip]);

  const addExpense = async () => {
    if (!desc.trim() || !amount || !paidBy || splitAmong.length === 0) return;
    setAdding(true);
    try {
      const shares: Record<string, number> = {};
      if (splitMode === "custom") {
        for (const mid of splitAmong) {
          const val = parseFloat(customShares[mid] || "1");
          if (val > 0) shares[mid] = val;
        }
      }
      const res = await fetch(`/api/trips/${id}/expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc.trim(), amount: parseFloat(amount), currency: expCurrency, paidBy, splitAmong, category, splitShares: splitMode === "custom" && Object.keys(shares).length > 0 ? shares : undefined, date: expDate ? new Date(expDate).getTime() : Date.now() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "❌ Failed to add expense");
        return;
      }
      setDesc(""); setAmount(""); setShowAdd(false);
      await loadTrip();
      showToast("✓ Expense added");
    } catch { showToast("❌ Failed to add expense"); } finally { setAdding(false); }
  };

  const editExpense = async (expenseId: string) => {
    if (!desc.trim() || !amount || !paidBy || splitAmong.length === 0) return;
    setAdding(true);
    try {
      const shares: Record<string, number> = {};
      if (splitMode === "custom") {
        for (const mid of splitAmong) {
          const val = parseFloat(customShares[mid] || "1");
          if (val > 0) shares[mid] = val;
        }
      }
      const res = await fetch(`/api/trips/${id}/expense`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId, description: desc.trim(), amount: parseFloat(amount), currency: expCurrency, paidBy, splitAmong, category, splitShares: splitMode === "custom" && Object.keys(shares).length > 0 ? shares : undefined, date: expDate ? new Date(expDate).getTime() : Date.now() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "❌ Failed to save expense");
        return;
      }
      setShowEdit(null); setDesc(""); setAmount("");
      await loadTrip();
      showToast("✓ Expense updated");
    } catch { showToast("❌ Failed to save expense"); } finally { setAdding(false); }
  };

  const deleteExpense = async (expenseId: string) => {
    try {
      await fetch(`/api/trips/${id}/expense`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId }),
      });
      await loadTrip();
    } catch { showToast("❌ Failed to delete expense"); }
  };

  const addPayment = async () => {
    if (!settleFrom || !settleTo || !settleAmount || settleFrom === settleTo) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/trips/${id}/payment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: settleFrom, to: settleTo, amount: parseFloat(settleAmount), note: settleNote.trim() || undefined, date: settleDate ? new Date(settleDate).getTime() : Date.now() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "❌ Failed to record payment");
        return;
      }
      setSettleAmount(""); setSettleNote("");
      await loadTrip();
      showToast("💰 Payment recorded");
    } catch { showToast("❌ Failed to record payment"); } finally { setAdding(false); }
  };

  const deletePayment = async (paymentId: string) => {
    try {
      await fetch(`/api/trips/${id}/payment`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      await loadTrip();
    } catch { showToast("❌ Failed to delete payment"); }
  };

  const toggleSplit = (memberId: string) => {
    setSplitAmong((prev) =>
      prev.includes(memberId) && prev.length > 1 ? prev.filter((id) => id !== memberId)
        : prev.includes(memberId) ? prev : [...prev, memberId]
    );
  };

  const startEdit = (exp: Expense) => {
    setShowEdit(exp.id); setShowAdd(false); setShowSettle(false);
    setDesc(exp.description); setAmount(exp.amount.toString());
    setExpCurrency(exp.currency); setPaidBy(exp.paidBy);
    setSplitAmong([...exp.splitAmong]); setCategory(exp.category);
    if (exp.splitShares && Object.keys(exp.splitShares).length > 0) {
      setSplitMode("custom");
      const shares: Record<string, string> = {};
      for (const [mid, val] of Object.entries(exp.splitShares)) { shares[mid] = String(val); }
      setCustomShares(shares);
    } else {
      setSplitMode("equal");
      setCustomShares({});
    }
    setExpDate(new Date(exp.date).toISOString().split("T")[0]);
  };

  const cancelEdit = () => {
    setShowEdit(null); setDesc(""); setAmount("");
    setExpCurrency(trip?.currency || "EUR");
    setPaidBy(trip?.members[0]?.id || "");
    setSplitAmong(trip?.members.map((m) => m.id) || []);
    setCategory("food");
    setSplitMode("equal");
    setCustomShares({});
    setExpDate(""); setSettleDate("");
  };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      if (confirmDelete.type === "expense") await deleteExpense(confirmDelete.id);
      else if (confirmDelete.type === "payment") await deletePayment(confirmDelete.id);
      else if (confirmDelete.type === "trip") {
        const res = await fetch(`/api/trips/${id}`, { method: "DELETE" });
        if (res.ok) { router.push("/"); return; }
        showToast("❌ Failed to delete trip");
      }
      showToast(confirmDelete.type === "expense" ? "🗑️ Expense deleted" : "🗑️ Payment deleted");
    } catch {}
    setDeleting(false);
    setConfirmDelete(null);
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-md mx-4 space-y-4">
          <div className="text-5xl">💔</div>
          <h2 className="text-xl font-bold text-foreground">Trip Not Found</h2>
          <p className="text-muted">{error}</p>
          <a href="/" className="inline-block bg-accent hover:bg-accent-hover text-background font-medium py-2.5 px-6 rounded-xl transition-all">Go Home</a>
        </div>
      </div>
    );
  }

  // Hooks must be called before any conditional returns (React rules of hooks)
  const categoryBreakdown = useMemo(() => {
    if (!trip) return [];
    const catTotals: Record<string, number> = {};
    for (const e of trip.expenses) { catTotals[e.category] = (catTotals[e.category] || 0) + e.amountEur; }
    return Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  }, [trip?.expenses]);
  const categoryBreakdownTotal = useMemo(() => categoryBreakdown.reduce((s, [, v]) => s + v, 0), [categoryBreakdown]);

  if (!trip) {
    return (<div className="flex-1 flex items-center justify-center min-h-screen"><div className="text-4xl animate-pulse">⏳</div></div>);
  }

  const currencySymbol = (code: string) => CURRENCIES.find((c) => c.code === code)?.symbol || code;
  const memberById = (mid: string) => trip.members.find((m) => m.id === mid);
  const catEmoji = (catId: string) => CATEGORIES.find((c) => c.id === catId)?.emoji || "📦";
  const curr = trip.currency;
  const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  return (
    <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <a href="/" className="text-muted hover:text-foreground transition-colors text-xl">←</a>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-foreground truncate">{trip.name}</h1>
          <p className="text-muted text-sm flex items-center gap-1 flex-wrap">
            {trip.members.map((m) => `${m.emoji} ${m.name}`).join(" · ")}
            <button onClick={() => setShowAddMember(true)} className="text-accent hover:text-accent-hover text-xs font-medium ml-1">+ Add</button>
          </p>
        </div>
        <a href={`/api/trips/${id}/export`} className="px-3 py-2 text-sm bg-surface hover:bg-surface-light border border-border rounded-lg text-muted hover:text-foreground transition-all">📥 CSV</a>
        <button onClick={() => setConfirmDelete({ type: "trip", id })} className="px-3 py-2 text-sm bg-surface hover:bg-red-500/10 text-muted hover:text-danger border border-border rounded-lg transition-all">🗑️</button>
      </div>

      {/* Total */}
      <div className="bg-surface border border-border rounded-2xl p-5 mb-4 text-center">
        <p className="text-muted text-sm mb-1">Total Expenses</p>
        <p className="text-3xl font-bold text-accent">{currencySymbol(curr)}{fmt(trip.totalExpenses)}</p>
      </div>

      {/* Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 mb-4">
          <h2 className="font-semibold text-foreground mb-3 text-sm">📊 By Category</h2>
          <div className="space-y-2">
            {categoryBreakdown.map(([catId, amount]) => {
              const cat = CATEGORIES.find((c) => c.id === catId);
              const pct = categoryBreakdownTotal > 0 ? (amount / categoryBreakdownTotal) * 100 : 0;
              return (
                <div key={catId} className="flex items-center gap-2">
                  <span className="text-sm w-6 text-center">{cat?.emoji || "📦"}</span>
                  <span className="text-xs text-muted w-20 truncate">{cat?.name || catId}</span>
                  <div className="flex-1 h-2 bg-surface-light rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted w-12 text-right">{pct.toFixed(0)}%</span>
                  <span className="text-xs text-foreground w-20 text-right">{currencySymbol(curr)}{fmt(amount).split(",")[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Balances */}
      {trip.balances.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 mb-4">
          <h2 className="font-semibold text-foreground mb-3">💰 Balances</h2>
          <div className="space-y-2">
            {trip.balances.map((b) => (
              <div key={b.memberId} className="flex items-center justify-between">
                <span className="text-foreground">{b.emoji} {b.name}</span>
                <span className={`font-medium ${b.balance > 0.01 ? "text-success" : b.balance < -0.01 ? "text-danger" : "text-muted"}`}>
                  {b.balance > 0.01 ? "+" : ""}{currencySymbol(curr)}{fmt(Math.abs(b.balance))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 mb-4">
        {(["expenses", "settle", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === t ? "bg-accent text-background" : "text-muted hover:text-foreground"}`}
          >
            {t === "expenses" ? "📝 Expenses" : t === "settle" ? "🔄 Settle Up" : "📜 History"}
          </button>
        ))}
      </div>

      {/* EXPENSES TAB */}
      {tab === "expenses" && (
        <div className="space-y-3 tab-content-enter">
          <button onClick={() => { setShowAdd(true); cancelEdit(); }}
            className="w-full bg-accent hover:bg-accent-hover text-background font-bold py-3 px-5 rounded-xl transition-all active:scale-95">
            + Add Expense
          </button>

          {/* Add Expense Form */}
          {showAdd && (
            <div className="bg-surface border border-accent/30 rounded-2xl p-5 space-y-4 animate-slide-down">
              <div className="flex items-center justify-between"><h3 className="font-semibold text-foreground">New Expense</h3><button onClick={() => setShowAdd(false)} className="text-muted hover:text-foreground">✕</button></div>
              <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What was it?" className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent transition-colors" autoFocus />
              <div className="flex gap-2">
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" step="0.01" min="0" className="flex-1 bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent" />
                <select value={expCurrency} onChange={(e) => setExpCurrency(e.target.value)} className="bg-surface-light border border-border rounded-xl px-3 py-3 text-foreground focus:outline-none focus:border-accent">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                </select>
              </div>
              <div className="flex gap-2 flex-wrap">
                {CATEGORIES.map((cat) => (<button key={cat.id} onClick={() => setCategory(cat.id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${category === cat.id ? "bg-accent text-background" : "bg-surface-light text-muted hover:text-foreground"}`}>{cat.emoji} {cat.name}</button>))}
              </div>
              <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent" />
              <div><label className="block text-sm font-medium text-muted mb-2">Paid by</label><div className="flex gap-2 flex-wrap">{trip.members.map((m) => (<button key={m.id} onClick={() => setPaidBy(m.id)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${paidBy === m.id ? "bg-accent text-background" : "bg-surface-light text-muted hover:text-foreground border border-border"}`}>{m.emoji} {m.name}</button>))}</div></div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-muted">Split among</label>
                  <div className="flex gap-1 bg-surface-light rounded-lg p-0.5">
                    <button type="button" onClick={() => { setSplitMode("equal"); setCustomShares({}); }} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${splitMode === "equal" ? "bg-accent text-background" : "text-muted hover:text-foreground"}`}>Equal</button>
                    <button type="button" onClick={() => setSplitMode("custom")} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${splitMode === "custom" ? "bg-accent text-background" : "text-muted hover:text-foreground"}`}>Custom</button>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {trip.members.map((m) => (
                    <button key={m.id} onClick={() => toggleSplit(m.id)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${splitAmong.includes(m.id) ? "bg-surface-light text-foreground border border-accent/50" : "bg-surface-light text-muted border border-border opacity-50"}`}>
                      {m.emoji} {m.name}
                      {splitMode === "custom" && splitAmong.includes(m.id) && (
                        <input type="number" min="0" step="1" value={customShares[m.id] || "1"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setCustomShares({ ...customShares, [m.id]: e.target.value })}
                          className="ml-1 w-12 bg-background border border-border rounded px-1 py-0.5 text-xs text-foreground text-center"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={addExpense} disabled={!desc.trim() || !amount || adding} className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-background font-bold py-3 rounded-xl transition-all active:scale-95">{adding ? "Adding..." : "✓ Add Expense"}</button>
            </div>
          )}

          {/* Edit Expense Form */}
          {showEdit && (
            <div className="bg-surface border border-warning/50 rounded-2xl p-5 space-y-4 animate-slide-down">
              <div className="flex items-center justify-between"><h3 className="font-semibold text-warning">✏️ Edit Expense</h3><button onClick={cancelEdit} className="text-muted hover:text-foreground">✕</button></div>
              <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent" />
              <div className="flex gap-2">
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01" min="0" className="flex-1 bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent" />
                <select value={expCurrency} onChange={(e) => setExpCurrency(e.target.value)} className="bg-surface-light border border-border rounded-xl px-3 py-3 text-foreground focus:outline-none focus:border-accent">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                </select>
              </div>
              <div className="flex gap-2 flex-wrap">{CATEGORIES.map((cat) => (<button key={cat.id} onClick={() => setCategory(cat.id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${category === cat.id ? "bg-accent text-background" : "bg-surface-light text-muted hover:text-foreground"}`}>{cat.emoji} {cat.name}</button>))}</div>
              <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent" />
              <div><label className="block text-sm font-medium text-muted mb-2">Paid by</label><div className="flex gap-2 flex-wrap">{trip.members.map((m) => (<button key={m.id} onClick={() => setPaidBy(m.id)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${paidBy === m.id ? "bg-accent text-background" : "bg-surface-light text-muted hover:text-foreground border border-border"}`}>{m.emoji} {m.name}</button>))}</div></div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-muted">Split among</label>
                  <div className="flex gap-1 bg-surface-light rounded-lg p-0.5">
                    <button type="button" onClick={() => { setSplitMode("equal"); setCustomShares({}); }} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${splitMode === "equal" ? "bg-accent text-background" : "text-muted hover:text-foreground"}`}>Equal</button>
                    <button type="button" onClick={() => setSplitMode("custom")} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${splitMode === "custom" ? "bg-accent text-background" : "text-muted hover:text-foreground"}`}>Custom</button>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {trip.members.map((m) => (
                    <button key={m.id} onClick={() => toggleSplit(m.id)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${splitAmong.includes(m.id) ? "bg-surface-light text-foreground border border-accent/50" : "bg-surface-light text-muted border border-border opacity-50"}`}>
                      {m.emoji} {m.name}
                      {splitMode === "custom" && splitAmong.includes(m.id) && (
                        <input type="number" min="0" step="1" value={customShares[m.id] || "1"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setCustomShares({ ...customShares, [m.id]: e.target.value })}
                          className="ml-1 w-12 bg-background border border-border rounded px-1 py-0.5 text-xs text-foreground text-center"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={cancelEdit} className="flex-1 bg-surface hover:bg-surface-light text-muted hover:text-foreground font-medium py-3 rounded-xl transition-all border border-border">Cancel</button>
                <button onClick={() => editExpense(showEdit)} disabled={!desc.trim() || !amount || adding} className="flex-1 bg-warning hover:bg-yellow-400 text-background font-bold py-3 rounded-xl transition-all active:scale-95 disabled:opacity-50">{adding ? "Saving..." : "💾 Save"}</button>
              </div>
            </div>
          )}

          {/* Expense List */}
          <h2 className="font-semibold text-foreground">📝 Expenses ({trip.expenses.length})</h2>
          {trip.expenses.length === 0 ? (
            <div className="text-center text-muted py-8 bg-surface rounded-2xl border border-border"><div className="text-3xl mb-2">🫙</div><p>No expenses yet</p><p className="text-sm mt-1">Tap &quot;Add Expense&quot; to start</p></div>
          ) : (
            [...trip.expenses].reverse().map((exp) => {
              const payer = memberById(exp.paidBy);
              const isForeign = exp.currency !== "EUR" && exp.currency !== curr;
              return (
                <div key={exp.id} className="bg-surface border border-border hover:border-accent/20 rounded-xl p-4 transition-all group">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{catEmoji(exp.category)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-medium truncate">{exp.description}</p>
                      <p className="text-muted text-sm mt-0.5">{payer?.emoji} {payer?.name} paid · {exp.splitAmong.length} way{isForeign && <span className="text-accent"> ≈ {currencySymbol(curr)}{fmt(exp.amountEur)}</span>}{!exp.rateAvailable && exp.currency !== "EUR" && <span className="text-warning text-xs ml-1">⚠️ rate</span>}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-foreground font-bold">{currencySymbol(exp.currency)}{fmt(exp.amount)}</p>
                      <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 sm-max:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(exp)} className="text-muted hover:text-warning text-xs">✏️</button>
                        <button onClick={() => setConfirmDelete({ type: "expense", id: exp.id })} className="text-muted hover:text-danger text-xs">🗑️</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SETTLE UP TAB */}
      {tab === "settle" && (
        <div className="space-y-3 tab-content-enter">
          {/* Who owes whom */}
          {trip.settlements.length > 0 && (
            <div className="bg-surface border border-accent/30 rounded-2xl p-4 space-y-3">
              <h2 className="font-semibold text-accent text-lg">🔄 Who owes whom</h2>
              {trip.settlements.map((s, i) => (
                <div key={i} className="flex items-center gap-2 bg-surface-light rounded-xl p-3">
                  <span className="font-medium text-foreground">{s.fromEmoji} {s.fromName}</span>
                  <span className="text-muted text-sm">owes</span>
                  <span className="font-bold text-accent">{currencySymbol(curr)}{fmt(s.amount)}</span>
                  <span className="text-muted text-sm">to</span>
                  <span className="font-medium text-foreground">{s.toEmoji} {s.toName}</span>
                </div>
              ))}
            </div>
          )}

          {trip.settlements.length === 0 && (
            <div className="bg-surface border border-success/30 rounded-2xl p-6 text-center">
              <p className="text-success font-medium text-lg">🎉 All settled up!</p>
              <p className="text-muted text-sm mt-1">No outstanding debts</p>
            </div>
          )}

          {/* Record Payment Form */}
          <button onClick={() => setShowSettle(!showSettle)}
            className="w-full bg-accent hover:bg-accent-hover text-background font-bold py-3 px-5 rounded-xl transition-all active:scale-95">
            💰 Record a Payment
          </button>

          {showSettle && (
            <div className="bg-surface border border-accent/30 rounded-2xl p-5 space-y-4 animate-slide-down">
              <h3 className="font-semibold text-foreground">Record Payment</h3>
              <div><label className="block text-sm font-medium text-muted mb-2">Who paid?</label><div className="flex gap-2 flex-wrap">{trip.members.map((m) => (<button key={m.id} onClick={() => setSettleFrom(m.id)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${settleFrom === m.id ? "bg-accent text-background" : "bg-surface-light text-muted hover:text-foreground border border-border"}`}>{m.emoji} {m.name}</button>))}</div></div>
              <div><label className="block text-sm font-medium text-muted mb-2">Paid to whom?</label><div className="flex gap-2 flex-wrap">{trip.members.filter((m) => m.id !== settleFrom).map((m) => (<button key={m.id} onClick={() => setSettleTo(m.id)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${settleTo === m.id ? "bg-accent text-background" : "bg-surface-light text-muted hover:text-foreground border border-border"}`}>{m.emoji} {m.name}</button>))}</div></div>
              <input type="number" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} placeholder="Amount" step="0.01" min="0" className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent" />
              <input type="text" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} placeholder="Note (optional)" className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent" />
              <input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent" />
              <button onClick={addPayment} disabled={!settleFrom || !settleTo || !settleAmount || adding} className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-background font-bold py-3 rounded-xl transition-all active:scale-95">{adding ? "Saving..." : "✓ Record Payment"}</button>
            </div>
          )}
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === "history" && (
        <div className="space-y-3 tab-content-enter">
          <h2 className="font-semibold text-foreground">📜 Payment History</h2>
          {(!trip.payments || trip.payments.length === 0) ? (
            <div className="text-center text-muted py-8 bg-surface rounded-2xl border border-border"><div className="text-3xl mb-2">📋</div><p>No payments recorded yet</p><p className="text-sm mt-1">Go to &quot;Settle Up&quot; to record one</p></div>
          ) : (
            [...trip.payments].reverse().map((p) => {
              const fromMember = memberById(p.from);
              const toMember = memberById(p.to);
              return (
                <div key={p.id} className="bg-surface border border-border rounded-xl p-4 group">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">💰</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-medium">{fromMember?.emoji} {fromMember?.name} → {toMember?.emoji} {toMember?.name}</p>
                      {p.note && <p className="text-muted text-sm">{p.note}</p>}
                      <p className="text-muted text-xs mt-0.5">{new Date(p.date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-accent font-bold">{currencySymbol(curr)}{fmt(p.amount)}</p>
                      <button onClick={() => setConfirmDelete({ type: "payment", id: p.id })} className="text-muted hover:text-danger text-xs opacity-0 group-hover:opacity-100 sm-max:opacity-100 transition-opacity">🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-foreground text-background px-5 py-3 rounded-xl font-medium text-sm shadow-lg z-40 animate-[fadeInUp_0.2s_ease-out]">
          {toast}
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4" onClick={() => setShowAddMember(false)}>
          <div className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">👋 Add Member</h3>
            <input type="text" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="Name" autoFocus className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent" onKeyDown={async (e) => {
              if (e.key === "Enter" && newMemberName.trim()) {
                const memberRes = await fetch(`/api/trips/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addMembers: [newMemberName.trim()] }) });
                if (!memberRes.ok) {
                  const err = await memberRes.json().catch(() => ({}));
                  showToast(err.error || "❌ Failed to add member");
                  return;
                }
                setNewMemberName(""); setShowAddMember(false); await loadTrip();
              }
            }} />
            <div className="flex gap-3">
              <button onClick={() => setShowAddMember(false)} className="flex-1 bg-surface-light border border-border text-muted hover:text-foreground font-medium py-2.5 rounded-xl transition-all">Cancel</button>
              <button onClick={async () => {
                if (!newMemberName.trim()) return;
                const memberRes = await fetch(`/api/trips/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addMembers: [newMemberName.trim()] }) });
                if (!memberRes.ok) {
                  const err = await memberRes.json().catch(() => ({}));
                  showToast(err.error || "❌ Failed to add member");
                  return;
                }
                setNewMemberName(""); setShowAddMember(false); await loadTrip();
              }} disabled={!newMemberName.trim()} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-background font-bold py-2.5 rounded-xl transition-all active:scale-95">Add</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-foreground">🗑️ Confirm Delete</h3>
            <p className="text-muted">{confirmDelete.type === "trip" ? "This will permanently delete the entire trip and all its data." : "Are you sure? This cannot be undone."}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 bg-surface-light border border-border text-muted hover:text-foreground font-medium py-2.5 rounded-xl transition-all">Cancel</button>
              <button onClick={executeDelete} disabled={deleting} className="flex-1 bg-danger hover:bg-red-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition-all active:scale-95">{deleting ? "Deleting..." : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}