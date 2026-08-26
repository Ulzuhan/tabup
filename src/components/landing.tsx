import Link from "next/link";
import {
  ArrowRight,
  CloudOff,
  Camera,
  Coins,
  FileDown,
  Repeat,
  SplitSquareHorizontal,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import { MESSAGES } from "@/i18n/messages";
import { Button } from "@/components/ui/button";

/**
 * What someone with no session sees.
 *
 * Server-rendered with no client JavaScript at all: it is the first thing a stranger
 * loads, often from a link on a phone, and there is nothing here that needs a hydration
 * pass to be useful.
 *
 * The mock below is deliberately real output — the same figures the app would produce
 * for those expenses — rather than a stock illustration. Showing the one screen that
 * matters says more than any amount of copy about balances.
 */
/**
 * Where somebody asks for an account.
 *
 * The flow lives in the identity provider and is specific to this service: it
 * creates the account inactive AND already in TabUp's group, so approving it is
 * one click and cannot forget to grant access.
 */
const ENROLL_URL = "https://auth.kaicorplabs.com/if/flow/enroll-tabup/";

export function Landing({ locale }: { locale: Locale; canRegister?: boolean }) {
  const t = MESSAGES[locale].landing;

  const features = [
    { Icon: Coins, title: t.f1Title, body: t.f1Body },
    { Icon: SplitSquareHorizontal, title: t.f2Title, body: t.f2Body },
    { Icon: CloudOff, title: t.f3Title, body: t.f3Body },
    { Icon: Camera, title: t.f4Title, body: t.f4Body },
    { Icon: Repeat, title: t.f5Title, body: t.f5Body },
    { Icon: FileDown, title: t.f6Title, body: t.f6Body },
  ];

  return (
    <div className="flex flex-1 flex-col">
      {/* La barra superior la pone el layout: es la misma en los cinco servicios. */}
      <main className="flex flex-1 flex-col">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      {/* overflow-x-clip because the bloom behind the demo card extends past the
          container, and on a phone that alone gives the page a horizontal scrollbar. */}
      <section className="mx-auto w-full max-w-5xl overflow-x-clip px-5 pt-10 pb-16 sm:pt-16 sm:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="text-center lg:text-left">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t.headline}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground text-pretty lg:mx-0">
              {t.sub}
            </p>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Button size="lg" className="h-12 px-7 text-base" render={<Link href={ENROLL_URL}>{t.getStarted}</Link>} />
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-7 text-base"
                render={<Link href="/login">{t.signIn}</Link>}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t.accountHint}</p>
          </div>

          <DemoCard t={t} locale={locale} />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="border-t border-border/60 bg-card/30">
        <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:py-20">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {t.features}
          </h2>

          <div className="mt-8 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ Icon, title, body }) => (
              <div key={title}>
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="size-[18px] text-primary" />
                </div>
                <h3 className="mt-3.5 font-medium">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Close ────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-5 py-16 text-center sm:py-24">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.ctaTitle}</h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground text-pretty">
          {t.ctaBody}
        </p>
        <Button
          size="lg"
          className="mt-7 h-12 px-7 text-base"
          render={
            <Link href={ENROLL_URL}>
              {t.getStarted}
              <ArrowRight className="size-4" />
            </Link>
          }
        />
      </section>

      </main>

      {/* Una frase de cierre, no un pie: el pie de la página es el de marca, que
          pone el layout. Dos elementos `footer` dejarían dos puntos de referencia
          a quien navegue por landmarks. */}
      <p className="border-t border-border/60 px-5 py-6 text-center text-xs text-muted-foreground">
        {t.footer}
      </p>
    </div>
  );
}

/**
 * A worked example, not a screenshot.
 *
 * Three expenses, three people, and the settlement the app would actually compute:
 * 246,80 split three ways is 82,27 each, so Ana is owed 60,53 and Bea 39,20 — and it
 * takes two payments, not three, because Cris covers both.
 */
function DemoCard({
  t,
  locale,
}: {
  t: (typeof MESSAGES)["es"]["landing"];
  locale: Locale;
}) {
  const money = (n: number) =>
    `€${new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)}`;

  const balances = [
    { name: "Ana", emoji: "😊", value: 60.53 },
    { name: "Bea", emoji: "😎", value: 39.2 },
    { name: "Cris", emoji: "🤠", value: -99.73 },
  ];

  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* A soft bloom behind the card, so it reads as lit rather than pasted on. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[3rem] opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 70%)",
        }}
      />

      <div className="edge-light overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-medium">{t.demoTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Ana · Bea · Cris</p>
        </div>

        <div className="px-5 py-5 text-center">
          <p className="text-[11px] tracking-wider text-muted-foreground uppercase">
            {t.demoTotal}
          </p>
          <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{money(246.8)}</p>
        </div>

        <div className="space-y-2.5 border-t border-border px-5 py-4">
          {balances.map((b) => (
            <div key={b.name} className="flex items-center gap-2.5 text-sm">
              <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-[13px]">
                {b.emoji}
              </span>
              <span className="flex-1">{b.name}</span>
              <span
                className={`tabular font-medium ${b.value > 0 ? "text-success" : "text-destructive"}`}
              >
                {b.value > 0 ? "+" : "−"}
                {money(Math.abs(b.value))}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t border-border bg-secondary/30 px-5 py-4">
          <p className="text-[11px] tracking-wider text-muted-foreground uppercase">
            {t.demoSettle}
          </p>
          <div className="mt-2.5 space-y-2">
            {[
              { from: "Cris", to: "Ana", amount: 60.53 },
              { from: "Cris", to: "Bea", amount: 39.2 },
            ].map((s) => (
              <div key={s.to} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{s.from}</span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <span className="flex-1 font-medium">{s.to}</span>
                <span className="tabular font-semibold text-primary">{money(s.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
