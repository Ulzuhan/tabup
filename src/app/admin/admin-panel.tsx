"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Check, KeyRound, Link2, Loader2, ShieldCheck, UserCheck, X } from "lucide-react";
import { useServerError, useT, useIntlLocale } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PendingUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

interface Account extends PendingUser {
  role: string;
}

interface ServerError {
  id: string;
  context: string;
  message: string;
  stack: string | null;
  firstSeen: number;
  lastSeen: number;
  count: number;
  acknowledgedAt: number | null;
}

/**
 * Running the instance.
 *
 * Con cuentas propias hay tres cosas aquí, y están aquí y no en un correo porque esta
 * instancia no manda ninguno: quién espera a que le dejen entrar, quién está ya dentro
 * —con la forma de darle una contraseña nueva cuando pierde la suya— y qué ha fallado
 * en el servidor sin que nadie estuviera mirando.
 *
 * **Con un proveedor de identidad solo queda la tercera.** Las dos primeras eran de la
 * era de las cuentas locales: con proveedor, ni hay solicitudes que aprobar aquí ni se
 * puede hacer nada sobre las cuentas, así que enseñarlas era prometer un mando que no
 * existe. Quien administra va al proveedor, y esta pantalla lo dice.
 *
 * Reachable only from the admin's own menu, and every API call re-checks the role:
 * hiding a page is not access control.
 */
export function AdminPanel({ localAuth }: { localAuth: boolean }) {
  const t = useT();
  const serverError = useServerError();
  const locale = useIntlLocale();

  const [pending, setPending] = useState<PendingUser[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [errors, setErrors] = useState<ServerError[]>([]);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resetting, setResetting] = useState<Account | null>(null);
  /** A freshly made recovery link, waiting to be copied into a chat. */
  const [resetLink, setResetLink] = useState<{ url: string; email: string } | null>(null);

  const load = useCallback(async () => {
    // Con proveedor de identidad no se pide la lista de cuentas: ese endpoint
    // responde 403 —las cuentas son del proveedor— y pedirlo igualmente dejaría la
    // pantalla entera en "algo ha ido mal", incluidos los errores del servidor, que
    // es lo único que esta página sigue teniendo que enseñar.
    const [usersRes, errorsRes] = await Promise.all([
      localAuth ? fetch("/api/admin/users").catch(() => null) : Promise.resolve(null),
      fetch("/api/admin/errors").catch(() => null),
    ]);

    if (localAuth && !usersRes?.ok) {
      setAllowed(false);
      return;
    }
    if (!localAuth && !errorsRes?.ok) {
      setAllowed(false);
      return;
    }

    if (usersRes?.ok) {
      const data = await usersRes.json();
      setPending(data.pending ?? []);
      setAccounts(data.users ?? []);
    }
    setAllowed(true);
    if (errorsRes?.ok) setErrors((await errorsRes.json()).errors ?? []);
  }, [localAuth]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  /**
   * Makes a way back in for somebody who cannot get in.
   *
   * Shown rather than sent, because there is no email on this instance: the admin copies
   * it into whatever they already talk on. That is also why it is worth saying out loud
   * on screen how long it lasts.
   */
  const makeResetLink = async (user: Account) => {
    setBusy(`link-${user.id}`);
    setResetLink(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, action: "reset-link" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(serverError(data, "common.somethingWrong"));
        return;
      }
      setResetLink({ url: `${window.location.origin}/reset/${data.token}`, email: data.email });
      toast.success(t("admin.resetLinkReady"));
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(null);
    }
  };

  const act = async (user: PendingUser, action: "approve" | "reject") => {
    setBusy(user.id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(serverError(data, "common.somethingWrong"));
        return;
      }
      setPending(data.pending ?? []);
      setAccounts(data.users ?? []);
      toast.success(
        action === "approve" ? t("admin.approved", { name: user.name }) : t("admin.rejected")
      );
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(null);
    }
  };

  const dismissErrors = async (action: "ack" | "clear", id?: string) => {
    setBusy(id ?? action);
    try {
      const res = await fetch("/api/admin/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "clear" ? { action: "clear" } : { id }),
      });
      if (!res.ok) return toast.error(t("common.somethingWrong"));
      setErrors((await res.json()).errors ?? []);
      if (action === "clear") toast.success(t("admin.cleared"));
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(null);
    }
  };

  const when = (at: number) =>
    new Date(at).toLocaleString(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <main className="kc-workspace mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-5 pb-16 sm:pt-8">
      <Link
        href="/"
        className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("common.back")}
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{t("admin.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(localAuth ? "admin.subtitle" : "admin.subtitleOidc")}
      </p>

      {allowed === null ? (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : !allowed ? (
        <p className="mt-6 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("common.somethingWrong")}
        </p>
      ) : (
        <div className="mt-8 space-y-10">
          {/* ── Account requests ──────────────────────────────────────── */}
          {/* Solo cuando las cuentas son de TabUp. Con un proveedor de identidad no
              hay solicitudes que aprobar aquí —quien puede entrar lo decide él— y
              esta sección era una lista vacía para siempre: mobiliario que hacía
              creer que las altas se gestionan en esta pantalla. */}
          {localAuth && (
          <section>
            <SectionHeading title={t("admin.requests")} hint={t("admin.requestsHint")} />

            {pending.length === 0 ? (
              <Empty Icon={UserCheck} title={t("admin.none")} />
            ) : (
              <ul className="space-y-2">
                {pending.map((user) => (
                  <li key={user.id}>
                    <Card>
                      <CardContent className="flex flex-wrap items-center gap-3 py-1">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{user.name}</p>
                          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t("admin.requestedOn", {
                              date: new Date(user.createdAt).toLocaleDateString(locale),
                            })}
                          </p>
                        </div>

                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => act(user, "reject")}
                            disabled={busy !== null}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-4" />
                            {t("admin.reject")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => act(user, "approve")}
                            disabled={busy !== null}
                          >
                            {busy === user.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                            {t("admin.approve")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
          )}

          {/* The link, once made. Sits above the list rather than inside a row: it is
              the thing to act on now, and it has to be easy to copy on a phone. */}
          {localAuth && resetLink && (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/[0.06] p-3">
              <div>
                <p className="text-sm font-medium">{t("admin.resetLinkReady")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("admin.resetLinkFor", { email: resetLink.email })}
                </p>
              </div>
              <div className="flex gap-2">
                <Input readOnly value={resetLink.url} className="h-9 min-w-0 flex-1 text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={() => {
                    navigator.clipboard?.writeText(resetLink.url);
                    toast.success(t("common.copied"));
                  }}
                >
                  {t("common.copy")}
                </Button>
              </div>
            </div>
          )}

          {/* ── Accounts ──────────────────────────────────────────────── */}
          {/* Con proveedor, esta lista era el reflejo local de sus cuentas y no dejaba
              hacer nada sobre ellas: ni contraseñas, ni enlaces de recuperación, ni
              altas. Quien administra tiene que ir al proveedor de todas formas, así
              que en vez de una copia que se queda vieja se dice dónde está lo real. */}
          {localAuth ? (
          <section>
            <SectionHeading
              title={t("admin.accounts")}
              hint={t("admin.accountsHint")}
            />

            <ul className="space-y-2">
              {accounts.map((user) => (
                <li key={user.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center gap-3 py-1">
                      <div className="min-w-0 flex-1">
                        {/* Same as the expense row: `truncate` on a flex box clips
                            without an ellipsis, so a long name was cut mid-letter. */}
                        <p className="flex items-center gap-1.5 font-medium">
                          <span className="truncate">{user.name}</span>
                          {user.role === "admin" && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              <ShieldCheck className="size-3" />
                              {t("admin.adminRole")}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("admin.joinedOn", {
                            date: new Date(user.createdAt).toLocaleDateString(locale),
                          })}
                        </p>
                      </div>

                      {localAuth && (
                        <>
                      {/* Two ways in, and the link is the one to reach for: it expires,
                          it works once, and the person chooses their own password
                          instead of being told one over a chat that keeps it forever. */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => makeResetLink(user)}
                        disabled={busy !== null}
                      >
                        {busy === `link-${user.id}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Link2 className="size-4" />
                        )}
                        {t("admin.resetLink")}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setResetting(user)}
                        disabled={busy !== null}
                      >
                        <KeyRound className="size-4" />
                        {t("admin.changePassword")}
                      </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
          ) : (
            <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              {t("admin.identityElsewhere")}
            </p>
          )}

          {/* ── Server errors ─────────────────────────────────────────── */}
          <section>
            <div className="flex items-end justify-between gap-3">
              <SectionHeading title={t("admin.errors")} hint={t("admin.errorsHint")} />
              {errors.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-3 shrink-0 text-muted-foreground"
                  onClick={() => dismissErrors("clear")}
                  disabled={busy !== null}
                >
                  {t("admin.clearAll")}
                </Button>
              )}
            </div>

            {errors.length === 0 ? (
              <Empty Icon={Check} title={t("admin.noErrors")} hint={t("admin.noErrorsHint")} />
            ) : (
              <ul className="space-y-2">
                {errors.map((error) => (
                  <li key={error.id}>
                    <Card
                      className={
                        error.acknowledgedAt == null ? "border-destructive/30" : undefined
                      }
                    >
                      <CardContent className="py-1">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle
                            className={`mt-0.5 size-4 shrink-0 ${
                              error.acknowledgedAt == null
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <code className="font-mono text-xs text-muted-foreground">
                                {error.context}
                              </code>
                              {error.count > 1 && (
                                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium">
                                  {t("admin.occurrences", { count: String(error.count) })}
                                </span>
                              )}
                              {error.acknowledgedAt == null && (
                                <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                                  {t("admin.newBadge")}
                                </span>
                              )}
                            </div>

                            <p className="mt-1 text-sm break-words">{error.message}</p>

                            {/* The stack is folded away: it matters when it matters, and
                                the rest of the time it buries the message. */}
                            {error.stack && (
                              <details className="mt-1.5">
                                <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                                  stack
                                </summary>
                                <pre className="mt-1 overflow-x-auto rounded-lg bg-secondary/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                                  {error.stack}
                                </pre>
                              </details>
                            )}

                            <p className="mt-1.5 text-xs text-muted-foreground">
                              {t("admin.lastSeen", { when: when(error.lastSeen) })}
                            </p>
                          </div>

                          {error.acknowledgedAt == null && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 text-muted-foreground"
                              onClick={() => dismissErrors("ack", error.id)}
                              disabled={busy !== null}
                            >
                              {busy === error.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                t("admin.dismiss")
                              )}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {localAuth && <PasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(name) => {
          setResetting(null);
          toast.success(t("admin.passwordChanged", { name }));
        }}
      />}
    </main>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function Empty({
  Icon,
  title,
  hint,
}: {
  Icon: typeof UserCheck;
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-secondary">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Handing somebody a new password.
 *
 * Says out loud what it does beyond setting it — every session of theirs ends — because
 * that is the part that surprises people, and it is the part that makes this useful when
 * the reason for the reset is that somebody else got in.
 */
function PasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: Account | null;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const t = useT();
  const serverError = useServerError();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, action: "password", password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(serverError(data, "common.somethingWrong"));
        return;
      }
      setPassword("");
      onDone(user.name);
    } catch {
      setError(t("common.serverUnreachable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPassword("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("admin.changePassword")}</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-new-password">{t("admin.newPassword")}</Label>
            <Input
              id="admin-new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.passwordHint")}
              className="h-11"
            />
          </div>

          <p className="rounded-xl border border-warning/25 bg-warning/[0.06] px-3.5 py-2.5 text-xs text-muted-foreground">
            {t("admin.passwordWarning")}
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="h-11 w-full" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : t("admin.changePassword")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
