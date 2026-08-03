"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { forgetTrips, localTripIds } from "@/lib/local-trips";
import { Wordmark } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  const registering = mode === "register";

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
          registering ? { email, name, password, claimTripIds } : { email, password, claimTripIds }
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
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <Link
        href="/"
        className="mb-8 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back
      </Link>

      <div className="mb-7 text-center">
        <p className="text-2xl font-semibold tracking-tight">
          <Wordmark />
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {registering ? "Keep your trips on every device." : "Welcome back."}
        </p>
      </div>

      <Card>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {registering && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
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
              <Label htmlFor="email">Email</Label>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete={registering ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={registering ? "At least 8 characters" : "••••••••"}
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
                "Create account"
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {registering ? "Already have an account?" : "New here?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(registering ? "login" : "register");
            setError(null);
          }}
          className="rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {registering ? "Sign in" : "Create one"}
        </button>
      </p>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        You do not need an account to split a bill.{" "}
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Start a trip without one
        </Link>
        .
      </p>
    </div>
  );
}
