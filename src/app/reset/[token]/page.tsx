"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, Loader2 } from "lucide-react";
import { useServerError, useT } from "@/i18n/provider";
import { Wordmark } from "@/components/app-header";
import { clearSessionCache } from "@/lib/session-cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Getting back into an account, from a link the admin sent.
 *
 * There is no email on this instance, so there is no machine to ask for a reset — you
 * ask the person who runs it and they send you one of these. No session is required and
 * none can be: somebody who could sign in would not be here.
 *
 * The account's address is shown before anything is typed. A link like this travels
 * through a chat and can be forwarded to the wrong person, and "you are about to change
 * the password of ana@…" is the moment that mistake is catchable.
 */
export default function ResetPage() {
  const t = useT();
  const serverError = useServerError();
  const router = useRouter();
  const token = useParams().token as string;

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "bad"; reason: "expired" | "used" | "unknown" | "pending" }
    | { status: "ready"; email: string; name: string }
  >({ status: "loading" });

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/auth/reset?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.state === "ok") {
          setState({ status: "ready", email: data.email, name: data.name });
        } else {
          setState({ status: "bad", reason: data.state ?? "unknown" });
        }
      })
      .catch(() => !cancelled && setState({ status: "bad", reason: "unknown" }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The three token states come back as bare words so they can be translated here
        // rather than arriving as a sentence in the wrong language.
        if (["expired", "used", "unknown"].includes(data.code)) {
          setState({ status: "bad", reason: data.code });
          return;
        }
        setError(serverError(data, "common.somethingWrong"));
        setBusy(false);
        return;
      }

      // The password is set either way. What does not follow, for an account still
      // waiting to be let in, is being signed in — so say that rather than dropping them
      // on a front page that will ask them to sign in and then refuse.
      if (data.pending) {
        setState({ status: "bad", reason: "pending" });
        return;
      }

      // Every other session was just closed, and this browser may have been somebody
      // else's a moment ago.
      clearSessionCache();
      router.push("/");
      router.refresh();
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

  if (state.status === "bad") {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <KeyRound className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-medium">{t(`reset.${state.reason}`)}</h1>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{t("reset.askAgain")}</p>
          <Button
            variant="outline"
            className="mt-6"
            render={<Link href="/login">{t("auth.signIn")}</Link>}
          />
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
        <h1 className="mt-4 text-lg font-medium">{t("reset.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("reset.forAccount", { email: state.email })}
        </p>
      </div>

      <Card>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t("reset.newPassword")}</Label>
              <Input
                id="password"
                type="password"
                required
                autoFocus
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.passwordHint")}
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
              {busy ? <Loader2 className="size-4 animate-spin" /> : t("reset.save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-5 text-center text-xs text-muted-foreground">{t("reset.willSignOut")}</p>
    </main>
  );
}
