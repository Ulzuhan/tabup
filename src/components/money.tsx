"use client";

import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/i18n/provider";
import { CURRENCIES } from "@/lib/types";

/**
 * Amounts.
 *
 * Every figure in the app goes through here so that they all line up in columns and
 * none of them jump width as a value changes — `tabular-nums` is doing the work, and
 * it only helps if it is applied everywhere rather than remembered case by case.
 */

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol || code;
}

/**
 * Formats an amount for a given locale.
 *
 * The locale is a parameter rather than a hook so this can also be called from
 * non-component code; `useAmountFormatter` below is the version components want.
 *
 * Aquí vivía además `formatAmount`, que fijaba `es-ES` «porque la agrupación
 * española es la de por defecto». Quince sitios la usaban dentro de componentes que
 * sí saben en qué idioma se está leyendo, así que en inglés una misma fila imprimía
 * el mismo importe dos veces y de dos formas: «€780.00» a la derecha —eso venía de
 * `Money`— y «€780,00 / month» debajo. Se ha ido: quien pinta dentro de la
 * aplicación usa el hook.
 */
export function formatAmountIn(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function useAmountFormatter() {
  const locale = useIntlLocale();
  return (value: number) => formatAmountIn(value, locale);
}

export function Money({
  amount,
  currency,
  className,
  /** Renders +/- and colours the value, for balances. */
  signed = false,
}: {
  amount: number;
  currency: string;
  className?: string;
  signed?: boolean;
}) {
  const format = useAmountFormatter();
  // Below one cent the sign is noise: it reads as a debt that cannot be settled.
  const settled = Math.abs(amount) < 0.01;
  const tone = !signed || settled ? "" : amount > 0 ? "text-success" : "text-destructive";
  const prefix = signed && !settled ? (amount > 0 ? "+" : "−") : "";

  return (
    <span className={cn("tabular", tone, className)}>
      {prefix}
      {currencySymbol(currency)}
      {format(Math.abs(amount))}
    </span>
  );
}
