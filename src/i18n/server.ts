import "server-only";

import { cookies, headers } from "next/headers";
import { isLocale, localeFromHeader, LOCALE_COOKIE, type Locale } from "./config";

export async function resolveLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;
  return localeFromHeader((await headers()).get("accept-language"));
}

export const intlLocale = (locale: Locale) => (locale === "es" ? "es-ES" : "en-GB");
