"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Compass, Loader2 } from "lucide-react";
import { useServerError, useT } from "@/i18n/provider";
import { Wordmark } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { clearSessionCache } from "@/lib/session-cache";

/**
 * Landing page for an invitation link.
 *
 * The dead end this replaces: scanning the QR of an owned trip returned a bare "trip
 * not found", which is true from the server's point of view and useless from the
 * visitor's — they were invited, and the app gave them nowhere to go. Here the trip is
 * named, and signing in or registering both end with them inside it.
 */
export default function JoinPage() {
  const t = useT();
  const serverError = useServerError();
  const router = useRouter();
  const token = useParams().token as string;

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "expired" }
    | {
        status: "ready";
        tripName: string;
        signedIn: boolean;
        userName: string | null;
        /** The seat this link was made for, when it was made for somebody in particular. */
        memberName: string | null;
      }
  >({ status: "loading" });

  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/join?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setState({ status: "expired" });
        const data = await res.json();
        setState({
          status: "ready",
          tripName: data.tripName,
          signedIn: data.signedIn,
          userName: data.userName,
          memberName: data.memberName ?? null,
        });
      })
      .catch(() => !cancelled && setState({ status: "expired" }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Already signed in: one tap and they are in. */
  const joinNow = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ status: "expired" });
        return;
      }
      // Same as on the sign-in screen: this browser may have been somebody else's.
      clearSessionCache();
      router.push(`/trip/${data.tripId}`);
    } catch {
      setError(t("common.serverUnreachable"));
      setBusy(false);
    }
  };

  /** No account yet, or signing in with one: the token travels with the credentials. */
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { email, name, password, inviteToken: token }
            : { email, password, inviteToken: token }
        ),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(serverError(data, "common.somethingWrong"));
        setBusy(false);
        return;
      }

      router.push(data.tripId ? `/trip/${data.tripId}` : "/");
    } catch {
      setError(t("common.serverUnreachable"));
      setBusy(false);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-16">
        <Skeleton className="mx-auto h-8 w-40" />
        <Skeleton className="mt-6 h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (state.status === "expired") {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <Compass className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-medium">{t("join.expired")}</h1>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{t("join.expiredHint")}</p>
          <Button variant="outline" className="mt-6" render={<Link href="/">{t("trip.goHome")}</Link>} />
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-7 text-center">
        <p className="text-2xl font-semibold tracking-tight">
          <Wordmark />
        </p>
        <h1 className="mt-4 text-lg font-medium">{t("join.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* When the link was made for one person, say whose seat it is: they were
              added to the split before they ever had an account, and landing straight
              into the right column is the point of inviting by email. */}
          {state.memberName
            ? t("join.subtitleSeat", { trip: state.tripName, name: state.memberName })
            : t("join.subtitle", { trip: state.tripName })}
        </p>
      </div>

      {state.signedIn ? (
        <Button className="h-11 w-full" onClick={joinNow} disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            t("join.joinAs", { name: state.userName ?? "" })
          )}
        </Button>
      ) : (
        <>
          <Card>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                {mode === "register" && (
                  <div className="space-y-2">
                    <Label htmlFor="name">{t("auth.name")}</Label>
                    <Input
                      id="name"
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">{t("auth.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "register" ? t("auth.passwordHint") : undefined}
                    className="h-11"
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}

                <Button type="submit" className="h-11 w-full" disabled={busy}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : mode === "register" ? (
                    t("join.createAccount")
                  ) : (
                    t("auth.signIn")
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setError(null);
              }}
              className="rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {mode === "register" ? t("join.signIn") : t("auth.createOne")}
            </button>
          </p>
        </>
      )}
    </main>
  );
}
