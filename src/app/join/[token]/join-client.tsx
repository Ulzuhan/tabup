"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useServerError, useT } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearSessionCache } from "@/lib/session-cache";

/**
 * Las dos piezas de la página de invitación que necesitan navegador.
 *
 * Todo lo demás —el nombre del grupo, si la invitación vive, si hay proveedor de
 * identidad— lo decide el servidor y llega ya resuelto: ver `page.tsx`.
 */

/** Ya hay sesión: un toque y dentro. */
export function JoinButton({ token, userName }: { token: string; userName: string }) {
  const t = useT();
  const serverError = useServerError();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Dos casos, y el servidor contesta lo mismo a los dos a propósito: la
        // invitación ha caducado, o a quien pulsa lo sacaron de este grupo y su
        // enlace de siempre ya no lo devuelve dentro. Se dice y se para. Recargar
        // no valía: la invitación sigue viva, así que la página volvería a pintar
        // el mismo botón y el mismo error, en bucle.
        setError(serverError(data, "join.expired"));
        setBusy(false);
        return;
      }
      // Igual que en la pantalla de entrada: este navegador pudo ser de otra persona.
      clearSessionCache();
      router.push(`/trip/${data.tripId}`);
    } catch {
      setError(t("common.serverUnreachable"));
      setBusy(false);
    }
  };

  return (
    <>
      <Button className="h-11 w-full" onClick={join} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : t("join.joinAs", { name: userName })}
      </Button>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Cuentas propias: el formulario de siempre, con el token viajando con las
 * credenciales para que registrarse y entrar en el grupo sean un solo paso.
 *
 * Solo se pinta cuando NO hay proveedor de identidad. Con proveedor, estas dos rutas
 * devuelven 404 a propósito —la identidad es del proveedor y una contraseña vieja no
 * debe poder esquivar su MFA—, y este formulario era un callejón sin salida: es
 * justo el fallo que se estaba arreglando.
 */
export function LocalJoinForm({ token }: { token: string }) {
  const t = useT();
  const serverError = useServerError();
  const router = useRouter();

  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      clearSessionCache();
      router.push(data.tripId ? `/trip/${data.tripId}` : "/");
    } catch {
      setError(t("common.serverUnreachable"));
      setBusy(false);
    }
  };

  return (
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
  );
}
