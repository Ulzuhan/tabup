"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Loader2 } from "lucide-react";
import { Wordmark } from "@/components/wordmark";
import { useServerError, useT } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearSessionCache } from "@/lib/session-cache";

/**
 * Sign in and registration on one screen.
 *
 * No longer routed: accounts live in Authentik and /login redirects there.
 * Kept because the password machinery behind it still works, and a provider
 * outage would otherwise leave no way in at all.
 */
export function LocalLoginForm() {
  const t = useT();
  const serverError = useServerError();
  const router = useRouter();
  // The landing links here with ?new=1 for "create account", so the form opens on the
  // step the person actually chose instead of making them switch again.
  const wantsNew = useSearchParams().get("new") === "1";
  const [mode, setMode] = useState<"login" | "register">(wantsNew ? "register" : "login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRegister, setCanRegister] = useState<boolean | null>(null);
  const [requested, setRequested] = useState(false);

  // Asked before offering the choice: proposing "create one" and then refusing it is
  // the kind of dead end that makes people think the app is broken.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => !cancelled && setCanRegister(Boolean(d.registrationOpen)))
      .catch(() => !cancelled && setCanRegister(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const registering = mode === "register";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registering ? { email, name, password } : { email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The server says "pending_approval" rather than a message, so the wording
        // lives here with the rest of the copy and gets translated.
        setError(
          data.code === "pending_approval"
            ? t("auth.pendingApproval")
            : serverError(data, "common.somethingWrong")
        );
        setBusy(false);
        return;
      }

      // Registered but waiting: no session was issued, so there is nowhere to go yet.
      if (data.pending) {
        setRequested(true);
        setBusy(false);
        return;
      }

      // Whatever the previous session left cached in this browser is not this person's.
      // Signing out is not the only way the reader changes: a device goes straight from
      // one account to another often enough, and offline reads would serve the old one.
      clearSessionCache();
      router.push("/");
      router.refresh();
    } catch {
      setError(t("common.serverUnreachable"));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <Link
        href="/"
        className="mb-8 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("common.back")}
      </Link>

      <div className="mb-7 text-center">
        {/* An h1, not a styled paragraph. This page had no heading of any kind, so
            anything navigating by headings — which is how a screen reader skims — found
            nothing to land on. It looks identical. */}
        <h1 className="text-2xl font-semibold tracking-tight">
          <Wordmark />
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {registering ? t("auth.keepAcrossDevices") : t("auth.welcomeBack")}
        </p>
      </div>

      {requested ? (
        <Card>
          <CardContent className="py-2 text-center">
            <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-primary/10">
              <Clock className="size-5 text-primary" />
            </div>
            <p className="font-medium">{t("auth.requested")}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("auth.requestedHint")}</p>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {registering && (
              <div className="space-y-2">
                <Label htmlFor="name">{t("auth.name")}</Label>
                <Input
                  id="name"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ana"
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
                placeholder="ana@example.com"
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
                autoComplete={registering ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={registering ? t("auth.passwordHint") : "••••••••"}
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
              ) : registering ? (
                t("auth.createAccount")
              ) : (
                t("auth.signIn")
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      )}

      {/* Without an email flow there is nothing to click here, so it says what to do
          instead of offering a button that cannot exist. Staring at a login form with no
          way forward is the dead end this replaces. */}
      {!registering && !requested && (
        <p className="mt-5 text-center text-xs text-muted-foreground">
          <span className="font-medium">{t("reset.forgot")}</span> {t("reset.forgotHint")}
        </p>
      )}

      {requested ? null : canRegister === false && !registering ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-3 text-center">
          <p className="text-sm font-medium">{t("auth.closed")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("auth.closedHint")}</p>
        </div>
      ) : (
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {registering ? t("auth.alreadyHaveAccount") : t("auth.newHere")}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(registering ? "login" : "register");
              setError(null);
            }}
            className="rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {registering ? t("auth.signIn") : t("auth.createOne")}
          </button>
        </p>
      )}

    </main>
  );
}
