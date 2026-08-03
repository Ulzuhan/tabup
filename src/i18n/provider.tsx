"use client";

import { createContext, useContext, useMemo } from "react";
import { MESSAGES, es } from "./messages";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "./config";

type Messages = typeof es;

/**
 * Paths into the message tree, as "section.key".
 *
 * Typed rather than plain strings so a renamed or misspelled key is a compile error
 * instead of the key itself appearing on screen.
 */
type Paths = {
  [S in keyof Messages]: Messages[S] extends string
    ? S
    : `${S & string}.${keyof Messages[S] & string}`;
}[keyof Messages];

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * Translation function.
 *
 * Falls back to Spanish for a key missing at runtime rather than rendering the raw
 * path: an untranslated string is bad, "trip.totalSpent" on screen is worse.
 */
export function useT() {
  const locale = useLocale();

  return useMemo(() => {
    const dict = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];

    return (path: Paths, vars?: Record<string, string | number>): string => {
      const [section, key] = path.split(".") as [keyof Messages, string];
      const branch = dict[section] ?? MESSAGES[DEFAULT_LOCALE][section];

      const value =
        typeof branch === "string"
          ? branch
          : ((branch as Record<string, string>)?.[key] ??
            (MESSAGES[DEFAULT_LOCALE][section] as Record<string, string>)?.[key]);

      if (typeof value !== "string") return path;
      if (!vars) return value;

      return value.replace(/\{(\w+)\}/g, (whole, name) =>
        name in vars ? String(vars[name]) : whole
      );
    };
  }, [locale]);
}

/**
 * Plural-aware translation.
 *
 * Picks between `key_one` and `key_other` using Intl.PluralRules, so "1 gasto" and
 * "2 gastos" both read correctly instead of the "1 gastos" you get from a single
 * string with the number substituted in.
 */
export function usePlural() {
  const locale = useIntlLocale();
  const t = useT();

  return useMemo(() => {
    const rules = new Intl.PluralRules(locale);
    return (base: string, count: number): string => {
      const form = rules.select(count) === "one" ? "one" : "other";
      return t(`${base}_${form}` as Parameters<typeof t>[0], { count });
    };
  }, [locale, t]);
}

/**
 * The BCP 47 tag for Intl formatting.
 *
 * Spanish gets es-ES specifically because number formatting differs across Spanish
 * regions — 1.234,56 in Spain, 1,234.56 in Mexico — and the amounts here should look
 * the same to everyone reading the same trip.
 */
export function useIntlLocale(): string {
  return useLocale() === "es" ? "es-ES" : "en-GB";
}

/** Persists the choice and reloads, so the server renders with the new language too. */
export function setLocale(locale: Locale) {
  const year = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${year}; samesite=lax`;
  window.location.reload();
}
