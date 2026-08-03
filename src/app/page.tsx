"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CURRENCIES, EMOJIS } from "@/lib/types";
import { forgetTrips, localTripIds, rememberTrip } from "@/lib/local-trips";

interface TripSummary {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
  expenseCount: number;
  createdAt: number;
  owned?: boolean;
  anonymous?: boolean;
}

interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: string;
}

export default function Home() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [usage, setUsage] = useState<{ trips: number; tripLimit: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tripName, setTripName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [members, setMembers] = useState(["", ""]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  /**
   * The list is two sources merged: trips the account owns or was given, and trips this
   * browser remembers from before there was an account. Anonymous trips live only in
   * localStorage, so without the second half they would vanish on this screen even
   * though their links still work.
   */
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const remembered = localTripIds();
      const [session, owned, local] = await Promise.all([
        fetch("/api/auth/me").then((r) => r.json()).catch(() => ({ user: null })),
        fetch("/api/trips").then((r) => r.json()).catch(() => ({ trips: [] })),
        remembered.length
          ? fetch("/api/trips/lookup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: remembered }),
            })
              .then((r) => r.json())
              .catch(() => ({ trips: [] }))
          : Promise.resolve({ trips: [] }),
      ]);

      if (cancelled) return;

      // Trips that no longer resolve were deleted elsewhere; stop carrying their ids.
      const alive = new Set((local.trips ?? []).map((t: TripSummary) => t.id));
      const stale = remembered.filter((id) => !alive.has(id));
      if (stale.length) forgetTrips(stale);

      const merged = new Map<string, TripSummary>();
      for (const trip of [...(owned.trips ?? []), ...(local.trips ?? [])]) {
        merged.set(trip.id, { ...merged.get(trip.id), ...trip });
      }

      setUser(session.user ?? null);
      setUsage(session.usage ?? null);
      setTrips([...merged.values()].sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  /**
   * Attaches the browser's leftover anonymous trips to the account.
   *
   * These are the ones created before signing in, or on this device while signed out.
   * Anything the server refuses — already owned, over the plan limit — is left alone
   * and stays in the local list.
   */
  const claimAnonymous = async () => {
    const ids = trips.filter((t) => t.anonymous).map((t) => t.id);
    if (ids.length === 0) return;
    setClaiming(true);

    const claimed: string[] = [];
    for (const id of ids) {
      const res = await fetch(`/api/trips/${id}/claim`, { method: "POST" }).catch(() => null);
      if (res?.ok) claimed.push(id);
    }

    forgetTrips(claimed);
    if (claimed.length > 0) {
      window.location.reload();
      return;
    }
    setClaiming(false);
  };

  const addMember = () => {
    if (members.length < 10) setMembers([...members, ""]);
  };

  const removeMember = (index: number) => {
    if (members.length > 2) {
      setMembers(members.filter((_, i) => i !== index));
    }
  };

  const updateMember = (index: number, value: string) => {
    const newMembers = [...members];
    newMembers[index] = value;
    setMembers(newMembers);
  };

  const createTrip = async () => {
    if (!tripName.trim() || members.filter((m) => m.trim()).length < 2) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tripName.trim(),
          currency,
          members: members.filter((m) => m.trim()).map((m) => ({ name: m.trim() })),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.error || "Could not create the trip");
        setCreating(false);
        return;
      }

      // Without an account the link is the only way back to it, so the browser keeps
      // the id. Signing in later offers these up to be claimed.
      if (!user) rememberTrip(data.id);
      window.location.href = `/trip/${data.id}`;
    } catch {
      setCreateError("Could not reach the server");
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-6 sm:py-10 max-w-2xl mx-auto w-full">
      {/* Session bar */}
      <div className="w-full flex items-center justify-end gap-3 mb-6 min-h-8 text-sm">
        {loading ? null : user ? (
          <>
            <span className="text-muted truncate">
              {user.name}
              {usage?.tripLimit != null && (
                <span className="ml-2 text-xs">
                  {usage.trips}/{usage.tripLimit} trips
                </span>
              )}
            </span>
            <button
              onClick={signOut}
              className="text-muted hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link href="/login" className="text-accent hover:text-accent-hover font-medium">
            Sign in
          </Link>
        )}
      </div>

      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-4xl sm:text-5xl font-bold mb-2">
          Tab<span className="text-accent">Up</span>
        </h1>
        <p className="text-muted text-sm sm:text-base">
          Track shared expenses. See who owes whom. No account needed. 💸
        </p>
      </div>

      {/* Create Button */}
      {!showCreate && (
        <div className="w-full space-y-4">
          <button
            onClick={() => setShowCreate(true)}
            className="w-full bg-accent hover:bg-accent-hover text-background font-bold py-4 px-6 rounded-xl transition-all active:scale-95 text-lg"
          >
            ✈️ New Trip
          </button>

          {/* Existing Trips */}
          {loading ? (
            <div className="text-center text-muted py-8">Loading trips...</div>
          ) : trips.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                Your Trips
              </h2>

              {/* Only shows when there is actually something to move onto the account. */}
              {user && trips.some((t) => t.anonymous) && (
                <div className="flex items-center gap-3 flex-wrap p-3 mb-3 bg-accent/5 border border-accent/20 rounded-xl text-sm">
                  <span className="flex-1 min-w-0 text-muted">
                    Some trips are still tied to this browser only.
                  </span>
                  <button
                    onClick={claimAnonymous}
                    disabled={claiming}
                    className="text-accent hover:text-accent-hover font-medium disabled:opacity-50"
                  >
                    {claiming ? "Saving…" : "Save to my account"}
                  </button>
                </div>
              )}
              {trips.map((trip) => (
                <a
                  key={trip.id}
                  href={`/trip/${trip.id}`}
                  className="flex items-center gap-4 p-4 bg-surface hover:bg-surface-light border border-border hover:border-accent/30 rounded-xl transition-all group"
                >
                  <div className="text-2xl">✈️</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground font-medium truncate group-hover:text-accent transition-colors">
                      {trip.name}
                    </p>
                    <p className="text-muted text-sm flex items-center gap-2 flex-wrap">
                      <span>
                        {trip.memberCount} members · {trip.expenseCount} expenses
                      </span>
                      {/* Says out loud that this one only exists as a link in this browser. */}
                      {trip.anonymous && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-light border border-border">
                          this device only
                        </span>
                      )}
                      {trip.owned === false && !trip.anonymous && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-light border border-border">
                          shared with you
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-muted text-xs">
                    {new Date(trip.createdAt).toLocaleDateString()}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted py-12 bg-surface rounded-2xl border border-border">
              <div className="text-4xl mb-3">🌍</div>
              <p>No trips yet</p>
              <p className="text-sm mt-1">Create one to get started!</p>
            </div>
          )}
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="w-full space-y-5">
          {/* Trip Name */}
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Trip Name</label>
            <input
              type="text"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="e.g. Weekend in Barcelona"
              className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent transition-colors"
              autoFocus
            />
          </div>

          {/* Currency */}
          <div>
            <label className="block text-sm font-medium text-muted mb-2">Default Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent transition-colors"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Members */}
          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              Members ({members.filter((m) => m.trim()).length} minimum)
            </label>
            <div className="space-y-2">
              {members.map((member, i) => (
                <div key={i} className="flex gap-2">
                  <span className="flex items-center justify-center w-10 h-12 bg-surface-light rounded-lg text-lg">
                    {EMOJIS[i % EMOJIS.length]}
                  </span>
                  <input
                    type="text"
                    value={member}
                    onChange={(e) => updateMember(i, e.target.value)}
                    placeholder={`Person ${i + 1}`}
                    className="flex-1 bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:border-accent transition-colors"
                  />
                  {members.length > 2 && (
                    <button
                      onClick={() => removeMember(i)}
                      className="px-3 text-muted hover:text-danger transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {members.length < 10 && (
              <button
                onClick={addMember}
                className="mt-2 text-accent hover:text-accent-hover text-sm font-medium transition-colors"
              >
                + Add member
              </button>
            )}
          </div>

          {createError && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
              {createError}
              {createError.includes("free plan") && (
                <>
                  {" "}
                  <Link href="/login" className="underline">
                    Sign in with another account
                  </Link>
                  , or create it without one by signing out.
                </>
              )}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 bg-surface hover:bg-surface-light text-muted hover:text-foreground font-medium py-3 px-5 rounded-xl transition-all border border-border"
            >
              Cancel
            </button>
            <button
              onClick={createTrip}
              disabled={!tripName.trim() || members.filter((m) => m.trim()).length < 2 || creating}
              className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-background font-bold py-3 px-5 rounded-xl transition-all active:scale-95"
            >
              {creating ? "Creating..." : "🚀 Create Trip"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}