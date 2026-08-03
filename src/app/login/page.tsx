"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { forgetTrips, localTripIds } from "@/lib/local-trips";

/**
 * Sign in and registration on one screen.
 *
 * The trips this browser has been using anonymously ride along in the request: the
 * server claims the ones that still have no owner, which turns "I have been using this
 * for a week" into an account without losing anything.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = mode === "register" ? "Creating account…" : "Signing in…";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const claimTripIds = localTripIds();

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { email, name, password, claimTripIds }
            : { email, password, claimTripIds }
        ),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setBusy(false);
        return;
      }

      // Claimed trips are on the account now; keeping them in localStorage would show
      // them twice on the home screen.
      if (data.claimed > 0) forgetTrips(claimTripIds);

      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="text-3xl font-bold">
            Tab<span className="text-accent">Up</span>
          </Link>
          <p className="text-muted text-sm mt-2">
            {mode === "register"
              ? "Keep your trips together on every device."
              : "Welcome back."}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-surface border border-border rounded-2xl p-6 space-y-4"
        >
          {mode === "register" && (
            <div>
              <label htmlFor="name" className="block text-sm text-muted mb-1.5">
                Name
              </label>
              <input
                id="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground outline-none focus:border-accent transition-colors"
                placeholder="Ana"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm text-muted mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground outline-none focus:border-accent transition-colors"
              placeholder="ana@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-muted mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-light border border-border rounded-xl px-4 py-3 text-foreground outline-none focus:border-accent transition-colors"
              placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-background font-bold py-3 rounded-xl transition-all active:scale-95"
          >
            {busy ? pending : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-muted mt-5">
          {mode === "register" ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setError(null);
            }}
            className="text-accent hover:text-accent-hover font-medium"
          >
            {mode === "register" ? "Sign in" : "Create one"}
          </button>
        </p>

        <p className="text-center text-xs text-muted mt-8">
          You do not need an account to split a bill.{" "}
          <Link href="/" className="text-accent hover:text-accent-hover">
            Start a trip without one
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
