"use client";

import Link from "next/link";
import { Compass, Repeat } from "lucide-react";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Moves between the two halves of the app.
 *
 * The first attempt was a full-width segmented control above the content: it ate a
 * whole band of the screen, read as a form field rather than navigation, and put the
 * switch at the very top of a phone, where a thumb does not reach.
 *
 * Now it is a bottom bar on phones — where the thumb already is, and where every app
 * puts its navigation — and a pair of quiet links in the header on wider screens, since
 * a bar pinned to the bottom of a desktop window is just odd.
 */
const SECTIONS = [
  { key: "trips", href: "/", Icon: Compass, label: "recurring.tabTrips" },
  { key: "recurring", href: "/recurring", Icon: Repeat, label: "recurring.tabRecurring" },
] as const;

export function SectionTabs({ current }: { current: "trips" | "recurring" }) {
  const t = useT();

  return (
    <>
      {/* Wide screens: inline and understated, part of the page rather than a control. */}
      <nav className="mb-6 hidden gap-1 sm:flex" aria-label="Sections">
        {SECTIONS.map(({ key, href, Icon, label }) => (
          <Link
            key={key}
            href={href}
            aria-current={current === key ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current === key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {t(label)}
          </Link>
        ))}
      </nav>

      {/*
        Phones: fixed to the bottom, clear of the home indicator. The spacer below
        reserves the same height in the flow so the last row of a list is never left
        hidden underneath it.
      */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Sections"
      >
        <div className="mx-auto flex max-w-2xl">
          {SECTIONS.map(({ key, href, Icon, label }) => (
            <Link
              key={key}
              href={href}
              aria-current={current === key ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors outline-none focus-visible:bg-secondary",
                current === key ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("size-5", current === key && "fill-primary/15")} />
              {t(label)}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

/** Reserves the height the fixed bar takes up on phones. */
export function SectionTabsSpacer() {
  return <div className="h-[4.5rem] sm:hidden" aria-hidden />;
}
