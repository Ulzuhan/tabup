/**
 * The theme, as a fact rather than as a component.
 *
 * Deliberately not in `components/theme.tsx`: that file is `"use client"`, and the root
 * layout is a server component that has to read this cookie before the first byte goes
 * out. Importing a client module from the server does not fail at build time — it fails
 * at request time, with a 500 on every page, which is how this was found.
 */
export const THEME_COOKIE = "tabup_theme";

export type Theme = "light" | "dark" | "system";

/** "system" is expressed by the absence of the cookie, so it is not one of these. */
export function isTheme(value: unknown): value is "light" | "dark" {
  return value === "light" || value === "dark";
}
