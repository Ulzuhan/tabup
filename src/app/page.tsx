"use client";

import { useState, useEffect } from "react";
import { CURRENCIES, EMOJIS } from "@/lib/types";

interface TripSummary {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
  expenseCount: number;
  createdAt: number;
}

export default function Home() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tripName, setTripName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [members, setMembers] = useState(["", ""]);
  const [creating, setCreating] = useState(false);

  // Load trips on mount
  useEffect(() => {
    fetch("/api/trips")
      .then((r) => r.json())
      .then((data) => setTrips(data.trips || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      window.location.href = `/trip/${data.id}`;
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8 sm:py-16 max-w-2xl mx-auto w-full">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-4xl sm:text-5xl font-bold mb-2">
          <span className="text-accent">Split</span>Trip
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
                    <p className="text-muted text-sm">
                      {trip.memberCount} members · {trip.expenseCount} expenses
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