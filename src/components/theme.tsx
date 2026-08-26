"use client";

import { useEffect } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/i18n/provider";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

/**
 * Keeps the `dark` class in step with whatever theme is actually showing.
 *
 * The colours do not come from here — they come from `data-theme` on <html>, written by
 * the server from a cookie, so the first paint is already right. This only exists for
 * shadcn's `dark:` variant, which is a handful of subtle input fills and needs a class
 * to hang off. It is the one part that cannot be resolved on the server, because when
 * the choice is "whatever the device says" only the device knows.
 */
export function ThemeSync() {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const chosen = root.dataset.theme;
      const dark = chosen ? chosen === "dark" : media.matches;
      root.classList.toggle("dark", dark);
      // La cabecera y el pie de marca leen `kc-light`: sin esto se quedarían
      // oscuros sobre una app en claro.
      root.classList.toggle("kc-light", !dark);
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return null;
}

/**
 * Applies a choice immediately and remembers it.
 *
 * No reload: the palette is a `light-dark()` pair on every token, so changing
 * `color-scheme` — which is all the attribute does — repaints the lot.
 */
export function setTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;

  const dark =
    theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  root.classList.toggle("dark", dark);
  root.classList.toggle("kc-light", !dark);

  const year = 60 * 60 * 24 * 365;
  const value = theme === "system" ? "" : theme;
  const expiry = theme === "system" ? "max-age=0" : `max-age=${year}`;
  document.cookie = `${THEME_COOKIE}=${value}; path=/; ${expiry}; samesite=lax`;
}

/** The picker, dropped into whichever menu is to hand — same shape as the language one. */
export function ThemeItems() {
  const t = useT();

  const options = [
    { value: "system", label: t("theme.system"), icon: Monitor },
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
  ] as const;

  // Wrapped in a group because the label *is* a group label: Base UI refuses to render
  // one outside a group, and does it as a production error code rather than a sentence.
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {t("theme.title")}
      </DropdownMenuLabel>
      {options.map((option) => (
        <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)}>
          <option.icon className="size-4" />
          {option.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}
