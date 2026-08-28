"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Download, ExternalLink, Loader2 } from "lucide-react";
import { useServerError, useT, useLocale, setLocale } from "@/i18n/provider";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { setTheme } from "@/components/theme";
import { PushToggle } from "@/components/push-toggle";
import { DeleteAccountDialog } from "@/components/delete-account";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCIES, EMOJIS } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Lo que la sesión sabe de ti. Coincide con `publicUser` en el servidor. */
export interface Profile {
  id: string;
  email: string;
  name: string;
  emoji: string | null;
  defaultCurrency: string;
  payTo: string | null;
  notifyExpenses: boolean;
  notifyComments: boolean;
  notifySettlements: boolean;
}

/**
 * Los ajustes, con el porqué de cada uno al lado.
 *
 * Dos formas de guardar, y la diferencia no es capricho: lo que se elige de una lista
 * —tu cara, la moneda, un aviso— se guarda al pulsarlo, porque la elección ya es el
 * gesto completo; lo que se escribe —tu nombre, cómo te pagan— lleva su botón, porque
 * mientras tecleas todavía no has decidido nada.
 */
export function SettingsForm({
  user,
  accountUrl,
  providerAccounts,
}: {
  user: Profile;
  /** La página de la cuenta en el proveedor, si quien despliega la publica. */
  accountUrl: string | null;
  /** Si la identidad la lleva un proveedor, que es otra pregunta: decide cómo se
      confirma cerrar la cuenta —allí no hay contraseña que comprobar—. */
  providerAccounts: boolean;
}) {
  const t = useT();
  const serverError = useServerError();
  const router = useRouter();
  const locale = useLocale();

  const [name, setName] = useState(user.name);
  const [payTo, setPayTo] = useState(user.payTo ?? "");
  const [emoji, setEmoji] = useState(user.emoji);
  const [currency, setCurrency] = useState(user.defaultCurrency);
  const [avisos, setAvisos] = useState({
    notifyExpenses: user.notifyExpenses,
    notifyComments: user.notifyComments,
    notifySettlements: user.notifySettlements,
  });
  const [guardando, setGuardando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);

  /** Manda solo lo que cambia: lo que no viaja, no se toca. */
  const guardar = async (parche: Record<string, unknown>, etiqueta: string) => {
    setGuardando(etiqueta);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parche),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(serverError(data, "common.somethingWrong"));
        return false;
      }
      toast.success(t("settings.saved"));
      // La cabecera pinta tu nombre desde el servidor: sin esto seguiría con el viejo.
      router.refresh();
      return true;
    } catch {
      toast.error(t("common.serverUnreachable"));
      return false;
    } finally {
      setGuardando(null);
    }
  };

  const exportar = async () => {
    setGuardando("export");
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        toast.error(t("common.somethingWrong"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tabup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setGuardando(null);
    }
  };

  return (
    <main className="kc-workspace mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-5 pb-16 sm:pt-8">
      <Link
        href="/"
        className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("common.back")}
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{t("settings.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>

      <div className="mt-8 space-y-10">
        {/* ── Tú ──────────────────────────────────────────────────────── */}
        <Section title={t("settings.you")}>
          <Field label={t("settings.name")} hint={t("settings.nameHint")}>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="h-11 min-w-0 flex-1"
              />
              <Button
                variant="outline"
                className="h-11 shrink-0"
                disabled={guardando !== null || !name.trim() || name === user.name}
                onClick={() => guardar({ name }, "name")}
              >
                {guardando === "name" ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
              </Button>
            </div>
          </Field>

          <Field label={t("settings.emoji")} hint={t("settings.emojiHint")}>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={emoji === e}
                  onClick={() => {
                    setEmoji(e);
                    guardar({ emoji: e }, "emoji");
                  }}
                  className={cn(
                    "grid size-10 place-items-center rounded-xl border text-lg transition-colors",
                    emoji === e
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary"
                  )}
                >
                  {e}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={emoji === null}
                onClick={() => {
                  setEmoji(null);
                  guardar({ emoji: null }, "emoji");
                }}
                className={cn(
                  "h-10 rounded-xl border px-3 text-xs transition-colors",
                  emoji === null ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"
                )}
              >
                {t("settings.emojiAny")}
              </button>
            </div>
          </Field>

          <Field label={t("settings.email")} hint={t("settings.emailHint")}>
            <p className="text-sm">{user.email}</p>
            {accountUrl && (
              <Button
                variant="outline"
                className="mt-3"
                render={
                  <a href={accountUrl} target="_blank" rel="noreferrer">
                    {t("settings.providerAccount")}
                    <ExternalLink className="size-3.5" />
                  </a>
                }
              />
            )}
          </Field>
        </Section>

        {/* ── Preferencias ────────────────────────────────────────────── */}
        <Section title={t("settings.preferences")}>
          <Field label={t("settings.defaultCurrency")} hint={t("settings.defaultCurrencyHint")}>
            <Select
              value={currency}
              onValueChange={(v) => {
                const code = String(v);
                setCurrency(code);
                guardar({ defaultCurrency: code }, "currency");
              }}
            >
              <SelectTrigger className="h-11 w-full">
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
          </Field>

          <Field label={t("settings.language")}>
            <div className="flex flex-wrap gap-2">
              {LOCALES.map((code) => (
                <Button
                  key={code}
                  variant={code === locale ? "default" : "outline"}
                  onClick={() => setLocale(code)}
                >
                  {code === locale && <Check className="size-4" />}
                  {LOCALE_NAMES[code]}
                </Button>
              ))}
            </div>
          </Field>

          <Field label={t("theme.title")}>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["system", "theme.system"],
                  ["light", "theme.light"],
                  ["dark", "theme.dark"],
                ] as const
              ).map(([value, etiqueta]) => (
                <Button key={value} variant="outline" onClick={() => setTheme(value)}>
                  {t(etiqueta)}
                </Button>
              ))}
            </div>
          </Field>
        </Section>

        {/* ── Cómo te pagan ───────────────────────────────────────────── */}
        <Section title={t("settings.payTo")}>
          <Field label={t("settings.payToLabel")} hint={t("settings.payToHint")}>
            <div className="flex gap-2">
              <Input
                value={payTo}
                onChange={(e) => setPayTo(e.target.value)}
                maxLength={140}
                placeholder={t("settings.payToPlaceholder")}
                className="h-11 min-w-0 flex-1"
              />
              <Button
                variant="outline"
                className="h-11 shrink-0"
                disabled={guardando !== null || payTo === (user.payTo ?? "")}
                onClick={() => guardar({ payTo }, "payTo")}
              >
                {guardando === "payTo" ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
              </Button>
            </div>
          </Field>
        </Section>

        {/* ── Avisos ──────────────────────────────────────────────────── */}
        <Section title={t("settings.notifications")} hint={t("settings.notificationsHint")}>
          <div className="rounded-xl border border-border bg-card p-1">
            <PushToggle variant="row" />
          </div>

          <div className="mt-3 space-y-1">
            {(
              [
                ["notifyExpenses", "settings.notifyExpenses"],
                ["notifyComments", "settings.notifyComments"],
                ["notifySettlements", "settings.notifySettlements"],
              ] as const
            ).map(([clave, etiqueta]) => (
              <label
                key={clave}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <span className="text-sm">{t(etiqueta)}</span>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={avisos[clave]}
                  onChange={(e) => {
                    const valor = e.target.checked;
                    setAvisos((a) => ({ ...a, [clave]: valor }));
                    guardar({ [clave]: valor }, clave);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("settings.notifyJoinedAlways")}</p>
        </Section>

        {/* ── Tus datos ───────────────────────────────────────────────── */}
        <Section title={t("settings.data")}>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("settings.export")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.exportHint")}</p>
              </div>
              <Button variant="outline" disabled={guardando !== null} onClick={exportar}>
                {guardando === "export" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {t("settings.exportAction")}
              </Button>
            </CardContent>
          </Card>

          <Button
            variant="ghost"
            className="mt-3 text-destructive hover:text-destructive"
            onClick={() => setBorrando(true)}
          >
            {t("account.deleteTitle")}
          </Button>
        </Section>
      </div>

      <DeleteAccountDialog
        open={borrando}
        onOpenChange={setBorrando}
        providerAccounts={providerAccounts}
        email={user.email}
      />
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-medium">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4 space-y-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
