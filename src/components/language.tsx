"use client";

import { Check } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useLocale, setLocale } from "@/i18n/provider";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";

/**
 * The language choices, shared by every menu that offers them.
 *
 * Vive junto a `theme.tsx`, que hace lo mismo con el tema: las dos son listas de
 * opciones sueltas para meter en cualquier menú, no menús en sí.
 */
export function LanguageItems() {
  const current = useLocale();

  return (
    <>
      {LOCALES.map((code) => (
        <DropdownMenuItem key={code} onClick={() => setLocale(code)}>
          {code === current ? (
            <Check className="size-4 text-primary" />
          ) : (
            <span className="size-4" />
          )}
          {LOCALE_NAMES[code]}
        </DropdownMenuItem>
      ))}
    </>
  );
}
