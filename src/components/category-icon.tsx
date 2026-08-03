import {
  Utensils,
  Car,
  BedDouble,
  Ticket,
  ShoppingBag,
  Pill,
  Package,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Category iconography.
 *
 * Emoji were doing this job before. They render differently on every platform, cannot
 * inherit colour or stroke weight, and sit on the text baseline rather than aligning
 * with the type — which is what made the old lists look uneven.
 */
const ICONS: Record<string, LucideIcon> = {
  food: Utensils,
  transport: Car,
  accommodation: BedDouble,
  activity: Ticket,
  shopping: ShoppingBag,
  health: Pill,
  other: Package,
};

/** Stable per-category colour, reused by the list and the breakdown bars. */
const TINTS: Record<string, string> = {
  food: "text-chart-1",
  transport: "text-chart-2",
  accommodation: "text-chart-3",
  activity: "text-chart-4",
  shopping: "text-chart-5",
  health: "text-chart-2",
  other: "text-muted-foreground",
};

export function categoryTint(category: string): string {
  return TINTS[category] ?? TINTS.other;
}

export function CategoryIcon({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const Icon = ICONS[category] ?? Package;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

/** The icon in its own tinted well, for list rows. */
export function CategoryBadge({ category }: { category: string }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
      <CategoryIcon category={category} className={cn("size-[18px]", categoryTint(category))} />
    </div>
  );
}
