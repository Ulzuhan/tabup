/**
 * Language handling.
 *
 * Deliberately NOT the sub-path routing Next's guide recommends (`/es/trip/abc`).
 * People have trip links saved and pasted into group chats, and prefixing every route
 * would break every one of them — for a two-language app that is a bad trade. The
 * locale rides in a cookie instead, falling back to the browser's Accept-Language, and
 * URLs stay exactly as they are.
 */

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";
export const LOCALE_COOKIE = "tabup_locale";

export const LOCALE_NAMES: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a language from an Accept-Language header.
 *
 * Only the primary subtag is compared, so `es-419` and `es-ES` both land on Spanish.
 * Quality values are honoured because a browser set to English first and Spanish
 * second should get English.
 */
export function localeFromHeader(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split("=")[1]) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
