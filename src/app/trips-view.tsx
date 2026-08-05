"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { clearSessionCache } from "@/lib/session-cache";
import {
  ArrowRight,
  Compass,
  Loader2,
  Plus,
  Receipt,
  Users,
  X,
} from "lucide-react";
import { CURRENCIES, EMOJIS } from "@/lib/types";
import { useT } from "@/i18n/provider";
import { AppHeader, Wordmark, type SessionUser } from "@/components/app-header";
import { SectionTabs, SectionTabsSpacer } from "@/components/section-tabs";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TripSummary {
  id: string;
  name: string;
  currency: string;
  memberCount: number;
  expenseCount: number;
  createdAt: number;
  owned?: boolean;
}

export function TripsView() {
  const t = useT();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [usage, setUsage] = useState<{ trips: number; tripLimit: number | null } | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tripName, setTripName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  // Empty: you are already in the trip, and everyone else can arrive by invitation.
  const [members, setMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Trips the account owns or was given. There is no other source any more. */
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [session, owned] = await Promise.all([
        fetch("/api/auth/me").then((r) => r.json()).catch(() => ({ user: null })),
        fetch("/api/trips").then((r) => (r.ok ? r.json() : { trips: [] })).catch(() => ({ trips: [] })),
      ]);

      if (cancelled) return;

      setUser(session.user ?? null);
      setPendingApprovals(session.pendingApprovals ?? 0);
      setUsage(session.usage ?? null);
      setTrips([...(owned.trips ?? [])].sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // The offline cache belongs to the browser, not to the account: leaving it behind
    // hands your trips to whoever signs in next on this device.
    clearSessionCache();
    window.location.reload();
  };


  const addMember = () => {
    if (members.length < 10) setMembers([...members, ""]);
  };

  const removeMember = (index: number) => {
    setMembers(members.filter((_, i) => i !== index));
  };

  const updateMember = (index: number, value: string) => {
    const next = [...members];
    next[index] = value;
    setMembers(next);
  };

  const namedMembers = members.filter((m) => m.trim());
  /**
   * A name for the trip is all it takes.
   *
   * Two people used to be required, which is backwards once anyone can be invited: at
   * this moment you do not know what the second person will be called, and inventing a
   * placeholder for them is exactly the typed-in name this is moving away from. You are
   * in the trip either way — the server seats the owner — so a trip of one that grows
   * by invitation is the normal way round.
   */
  const canCreate = tripName.trim().length > 0;

  const createTrip = async () => {
    if (!canCreate) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tripName.trim(),
          currency,
          members: namedMembers.map((m) => ({ name: m.trim() })),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.error || t("createTrip.failed"));
        setCreating(false);
        return;
      }

      window.location.href = `/trip/${data.id}`;
    } catch {
      setCreateError(t("common.serverUnreachable"));
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-5 pb-16 sm:pt-8">
      <AppHeader user={user} loading={loading} onSignOut={signOut} showWordmark={false} pendingApprovals={pendingApprovals} />
      <SectionTabs current="trips" />

      {showCreate ? (
        <CreateTripForm
          tripName={tripName}
          setTripName={setTripName}
          currency={currency}
          setCurrency={setCurrency}
          userName={user?.name ?? ""}
          members={members}
          addMember={addMember}
          removeMember={removeMember}
          updateMember={updateMember}
          canCreate={canCreate}
          creating={creating}
          error={createError}
          onCancel={() => {
            setShowCreate(false);
            setCreateError(null);
          }}
          onSubmit={createTrip}
        />
      ) : (
        <>
          <section className="mb-9 text-center">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-[2.75rem]">
              <Wordmark />
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
              {t("home.tagline")}
            </p>
          </section>

          <Button size="lg" className="h-12 w-full text-base" onClick={() => setShowCreate(true)}>
            <Plus className="size-5" />
            {t("home.newTrip")}
          </Button>

          <section className="mt-8">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-[68px] w-full rounded-xl" />
                <Skeleton className="h-[68px] w-full rounded-xl" />
              </div>
            ) : trips.length > 0 ? (
              <>
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    {t("home.yourTrips")}
                  </h2>
                  {usage?.tripLimit != null && (
                    <span className="text-xs text-muted-foreground tabular">
                      {usage.trips}/{usage.tripLimit}
                    </span>
                  )}
                </div>

                <ul className="space-y-2">
                  {trips.map((trip) => (
                    <li key={trip.id}>
                      <TripRow trip={trip} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState signedIn={Boolean(user)} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TripRow({ trip }: { trip: TripSummary }) {
  const t = useT();
  return (
    <Link
      href={`/trip/${trip.id}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors outline-none hover:border-primary/30 hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
        <Compass className="size-[18px] text-muted-foreground transition-colors group-hover:text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{trip.name}</p>
        <p className="mt-0.5 flex items-center gap-3 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            <span className="tabular">{trip.memberCount}</span>
          </span>
          <span className="flex items-center gap-1">
            <Receipt className="size-3.5" />
            <span className="tabular">{trip.expenseCount}</span>
          </span>
          {trip.owned === false && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
              {t("home.shared")}
            </Badge>
          )}
        </p>
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function EmptyState({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
        <Compass className="size-6 text-muted-foreground" />
      </div>
      <p className="font-medium">{t("home.noTrips")}</p>
      <p className="mx-auto mt-1.5 max-w-[15rem] text-sm text-muted-foreground">
        {t("home.noTripsHint")}
      </p>
      {!signedIn && (
        <p className="mt-5 text-sm text-muted-foreground">
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            {t("auth.signIn")}
          </Link>{" "}
          {t("home.signInToKeep")}
        </p>
      )}
      <SectionTabsSpacer />
    </div>
  );
}

function CreateTripForm({
  tripName,
  setTripName,
  currency,
  setCurrency,
  userName,
  members,
  addMember,
  removeMember,
  updateMember,
  canCreate,
  creating,
  error,
  onCancel,
  onSubmit,
}: {
  tripName: string;
  setTripName: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  /** Shown as the first participant: the owner is always in their own trip. */
  userName: string;
  members: string[];
  addMember: () => void;
  removeMember: (i: number) => void;
  updateMember: (i: number, v: string) => void;
  canCreate: boolean;
  creating: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useT();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("createTrip.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("createTrip.subtitle")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="trip-name">{t("createTrip.name")}</Label>
        <Input
          id="trip-name"
          autoFocus
          value={tripName}
          onChange={(e) => setTripName(e.target.value)}
          placeholder={t("createTrip.namePlaceholder")}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="currency">{t("createTrip.currency")}</Label>
        <Select value={currency} onValueChange={(v) => setCurrency(String(v))}>
          <SelectTrigger id="currency" className="h-11 w-full">
            {/* SelectValue renders the raw value, so the symbol and name are spelled
                out here rather than being silently dropped from the trigger. */}
            <SelectValue>
              {(value) => {
                const c = CURRENCIES.find((x) => x.code === value);
                return c ? `${c.symbol}  ${c.code} — ${c.name}` : String(value ?? "");
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="tabular text-muted-foreground">{c.symbol}</span>{" "}
                <span className="font-medium">{c.code}</span>{" "}
                <span className="text-muted-foreground">— {c.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>{t("createTrip.people")}</Label>
          <span className="text-xs text-muted-foreground">{t("createTrip.inviteLater")}</span>
        </div>

        <div className="space-y-2">
          {/* You are in it before anyone else is added, which is what the server does
              too — and what makes a trip of one perfectly valid. */}
          <div className="flex items-center gap-2 rounded-xl bg-secondary/40 px-2 py-1.5">
            <MemberAvatar emoji={EMOJIS[0]} size="lg" />
            <span className="min-w-0 flex-1 truncate text-sm">{userName}</span>
            <span className="shrink-0 pr-1 text-xs text-muted-foreground">
              {t("manage.you")}
            </span>
          </div>

          {members.map((member, i) => (
            <div key={i} className="flex items-center gap-2">
              <MemberAvatar emoji={EMOJIS[(i + 1) % EMOJIS.length]} size="lg" />
              <Input
                value={member}
                onChange={(e) => updateMember(i, e.target.value)}
                placeholder={t("createTrip.person", { n: i + 2 })}
                className="h-11 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeMember(i)}
                aria-label={t("createTrip.person", { n: i + 2 })}
                className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {members.length < 10 && (
          <Button type="button" variant="ghost" size="sm" onClick={addMember} className="mt-1">
            <Plus className="size-4" />
            {t("createTrip.addMember")}
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={!canCreate || creating}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : t("createTrip.create")}
        </Button>
      </div>
    </form>
  );
}
