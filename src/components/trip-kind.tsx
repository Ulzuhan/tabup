"use client";

import { Compass, Heart, House, Users } from "lucide-react";
import { TRIP_KINDS, type TripKind } from "@/lib/types";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * What kind of group this is.
 *
 * It changes no rule and no arithmetic: the icon on the list and the word in the copy,
 * nothing more. It exists because calling every group a "trip" made half of what people
 * actually use this for read as a mistake — a flat share is not a holiday that never
 * ends — and the app said "viaje" on every screen regardless.
 */
const ICONS: Record<TripKind, typeof Compass> = {
  trip: Compass,
  home: House,
  couple: Heart,
  other: Users,
};

export function TripKindIcon({ kind, className }: { kind: TripKind; className?: string }) {
  const Icon = ICONS[kind] ?? Compass;
  return <Icon className={className} />;
}

export function useKindName() {
  const t = useT();
  return (kind: TripKind) =>
    ({
      trip: t("kind.trip"),
      home: t("kind.home"),
      couple: t("kind.couple"),
      other: t("kind.other"),
    })[kind] ?? t("kind.trip");
}

/** The picker, shown once when a group is created. Four choices fit on one row. */
export function TripKindPicker({
  value,
  onChange,
}: {
  value: TripKind;
  onChange: (kind: TripKind) => void;
}) {
  const kindName = useKindName();

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {TRIP_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          onClick={() => onChange(kind)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === kind
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
          )}
        >
          <TripKindIcon kind={kind} className="size-4" />
          {kindName(kind)}
        </button>
      ))}
    </div>
  );
}
