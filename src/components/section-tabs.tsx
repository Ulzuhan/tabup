"use client";

import Link from "next/link";
import { Compass, Repeat } from "lucide-react";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Switches between the two halves of the app.
 *
 * They are deliberately separate: a trip is shared, temporary and about who owes whom;
 * fixed costs are personal, permanent and about where the money goes. Mixing them into
 * one list would make both worse, so the split is the first thing the interface says.
 */
export function SectionTabs({ current }: { current: "trips" | "recurring" }) {
  const t = useT();

  const tabs = [
    { key: "trips" as const, href: "/", label: t("recurring.tabTrips"), Icon: Compass },
    { key: "recurring" as const, href: "/recurring", label: t("recurring.tabRecurring"), Icon: Repeat },
  ];

  return (
    <nav className="flex gap-0.5 rounded-xl bg-secondary p-0.5" aria-label="Sections">
      {tabs.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={current === key ? "page" : undefined}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            current === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
