"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface LandingSessionLabels {
  signedInAs: string;
  continueAs: string;
  askAccess: string;
  pendingNote: string;
  viewRequest: string;
  inviteNote: string;
  yourAccount: string;
}

type SessionState =
  | { kind: "continue"; name: string }
  | { kind: "pending" | "requestable" | "invite_only"; name: string; accountUrl: string };

const SIGNED_OUT_KEY = "kc_signed_out";
const ATTEMPTED_KEY = "kc_sso_attempted";
const COOLDOWN_MS = 60_000;

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {}
}

function clearStorage(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {}
}

export function LandingSession({
  sessionUrl,
  loginHref = "/api/auth/oidc",
  labels,
  children,
}: {
  sessionUrl?: string | null;
  loginHref?: string;
  labels: LandingSessionLabels;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    if (!sessionUrl) return;
    let cancelled = false;

    const url = new URL(window.location.href);
    if (url.searchParams.get("signed_out") === "1") {
      writeStorage(SIGNED_OUT_KEY, "1");
      url.searchParams.delete("signed_out");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }

    const signinError = url.searchParams.has("error");
    const attemptedAt = Number(readStorage(ATTEMPTED_KEY) || "0");
    const suppressed =
      signinError ||
      readStorage(SIGNED_OUT_KEY) === "1" ||
      (Number.isFinite(attemptedAt) && attemptedAt > 0 && Date.now() - attemptedAt < COOLDOWN_MS);

    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(4000)
        : undefined;

    fetch(sessionUrl, { credentials: "include", cache: "no-store", signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          s: {
            signed_in?: boolean;
            name?: string;
            tool_access?: string;
            account_url?: string;
          } | null
        ) => {
          if (cancelled || !s?.signed_in) return;
          const name = String(s.name || "account").slice(0, 40);
          const accountUrl =
            typeof s.account_url === "string" && s.account_url
              ? s.account_url
              : new URL("/", sessionUrl).toString();

          if (s.tool_access === "granted") {
            if (!suppressed) {
              writeStorage(ATTEMPTED_KEY, String(Date.now()));
              window.location.replace(loginHref);
              return;
            }
            setState({ kind: "continue", name });
            return;
          }

          if (
            s.tool_access === "pending" ||
            s.tool_access === "requestable" ||
            s.tool_access === "invite_only"
          ) {
            setState({ kind: s.tool_access, name, accountUrl });
          }
        }
      )
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sessionUrl, loginHref]);

  if (!state) return <>{children}</>;

  const clearSuppression = () => {
    clearStorage(SIGNED_OUT_KEY);
    clearStorage(ATTEMPTED_KEY);
  };

  if (state.kind === "continue") {
    return (
      <>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
          <Button
            size="lg"
            className="h-12 px-7 text-base"
            render={
              <a href={loginHref} onClick={clearSuppression}>
                {labels.continueAs.replace("{name}", state.name)}
              </a>
            }
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {labels.signedInAs.replace("{name}", state.name)}
        </p>
      </>
    );
  }

  const ctaLabel =
    state.kind === "requestable"
      ? labels.askAccess
      : state.kind === "pending"
        ? labels.viewRequest
        : labels.yourAccount;
  const noteText =
    state.kind === "pending"
      ? labels.pendingNote
      : state.kind === "invite_only"
        ? labels.inviteNote
        : "";

  return (
    <>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
        <Button
          size="lg"
          variant={state.kind === "requestable" ? undefined : "outline"}
          className="h-12 px-7 text-base"
          render={<a href={state.accountUrl}>{ctaLabel}</a>}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {labels.signedInAs.replace("{name}", state.name)}
        {noteText ? ` · ${noteText}` : ""}
      </p>
    </>
  );
}
