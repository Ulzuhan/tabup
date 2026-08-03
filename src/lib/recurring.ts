/**
 * Recurring expense maths.
 *
 * Pure, with no server imports, so the browser runs exactly this — the same reason the
 * trip balances live apart. Two implementations of "what does this cost me a month"
 * would drift, and the drift would only show up as the app and the export disagreeing.
 */

export type Period = "weekly" | "monthly" | "quarterly" | "yearly";

export const PERIODS: Period[] = ["weekly", "monthly", "quarterly", "yearly"];

export interface Recurring {
  id: string;
  name: string;
  amount: number;
  currency: string;
  amountBase: number;
  period: Period;
  chargeDay: number;
  chargeMonth?: number | null;
  category: string;
  startedAt: number;
  endedAt?: number | null;
  note?: string | null;
}

/**
 * What one item costs per month on average.
 *
 * A year is 12 months and a quarter is 3, but a week is not four: paying weekly means
 * 52 charges a year, not 48. Using 4 would under-report a weekly cost by about 8%,
 * which is exactly the kind of quiet error this whole section exists to avoid.
 */
export function monthlyEquivalent(item: Pick<Recurring, "amountBase" | "period">): number {
  switch (item.period) {
    case "weekly":
      return (item.amountBase * 52) / 12;
    case "quarterly":
      return item.amountBase / 3;
    case "yearly":
      return item.amountBase / 12;
    default:
      return item.amountBase;
  }
}

export function yearlyEquivalent(item: Pick<Recurring, "amountBase" | "period">): number {
  return monthlyEquivalent(item) * 12;
}

/** Whether an item was being paid at a given moment. */
export function activeAt(item: Recurring, at: number): boolean {
  if (item.startedAt > at) return false;
  return item.endedAt == null || item.endedAt > at;
}

/** Whether it is being paid at any point during a given month. */
export function activeInMonth(item: Recurring, year: number, month: number): boolean {
  const first = new Date(year, month, 1).getTime();
  const last = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
  if (item.startedAt > last) return false;
  return item.endedAt == null || item.endedAt >= first;
}

export function monthlyTotal(items: Recurring[], at = Date.now()): number {
  return items
    .filter((item) => activeAt(item, at))
    .reduce((sum, item) => sum + monthlyEquivalent(item), 0);
}

/** Monthly equivalent per category, biggest first. */
export function byCategory(items: Recurring[], at = Date.now()): [string, number][] {
  const totals: Record<string, number> = {};
  for (const item of items) {
    if (!activeAt(item, at)) continue;
    totals[item.category] = (totals[item.category] ?? 0) + monthlyEquivalent(item);
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

/**
 * The next date an item is charged, at or after `from`.
 *
 * The charge day is clamped to the length of the month, so something billed on the 31st
 * lands on the 28th in February rather than silently rolling into March — which is what
 * `new Date(2026, 1, 31)` would do.
 */
export function nextCharge(item: Recurring, from = Date.now()): number | null {
  if (item.endedAt != null && item.endedAt <= from) return null;

  const start = new Date(Math.max(item.startedAt, from));
  const clampDay = (year: number, month: number) =>
    Math.min(item.chargeDay, new Date(year, month + 1, 0).getDate());

  let candidate: Date;

  if (item.period === "weekly") {
    // Weekly has no calendar day to anchor to; it repeats from the start date.
    const week = 7 * 86_400_000;
    const elapsed = Math.max(0, from - item.startedAt);
    candidate = new Date(item.startedAt + Math.ceil(elapsed / week) * week);
  } else if (item.period === "yearly") {
    const month = (item.chargeMonth ?? new Date(item.startedAt).getMonth() + 1) - 1;
    let year = start.getFullYear();
    candidate = new Date(year, month, clampDay(year, month));
    if (candidate.getTime() < from) {
      year += 1;
      candidate = new Date(year, month, clampDay(year, month));
    }
  } else {
    const step = item.period === "quarterly" ? 3 : 1;
    const base = new Date(item.startedAt);
    let year = start.getFullYear();
    let month = start.getMonth();

    // Quarterly repeats from the starting month, not from January.
    if (step === 3) {
      const offset = (((month - base.getMonth()) % 3) + 3) % 3;
      month -= offset;
    }

    candidate = new Date(year, month, clampDay(year, month));
    if (candidate.getTime() < from) {
      month += step;
      year += Math.floor(month / 12);
      month = ((month % 12) + 12) % 12;
      candidate = new Date(year, month, clampDay(year, month));
    }
  }

  const time = candidate.getTime();
  if (item.endedAt != null && time > item.endedAt) return null;
  return time;
}

export interface UpcomingCharge {
  item: Recurring;
  at: number;
}

/** Everything charged in the next `days`, soonest first. */
export function upcoming(items: Recurring[], days = 30, from = Date.now()): UpcomingCharge[] {
  const until = from + days * 86_400_000;
  const result: UpcomingCharge[] = [];

  for (const item of items) {
    let at = nextCharge(item, from);
    // A weekly item can fall several times inside the window.
    while (at != null && at <= until) {
      result.push({ item, at });
      const next = nextCharge(item, at + 86_400_000);
      if (next == null || next === at) break;
      at = next;
    }
  }

  return result.sort((a, b) => a.at - b.at);
}

/**
 * What a given month actually cost.
 *
 * Only the charges that fall inside it, not the monthly average — a yearly insurance
 * premium makes one month expensive and the other eleven cheap, and averaging that away
 * would hide the very spike worth knowing about.
 */
export function chargedInMonth(items: Recurring[], year: number, month: number): number {
  const first = new Date(year, month, 1).getTime();
  const last = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();

  let total = 0;
  for (const item of items) {
    if (!activeInMonth(item, year, month)) continue;
    let at = nextCharge(item, first);
    while (at != null && at <= last) {
      total += item.amountBase;
      const next = nextCharge(item, at + 86_400_000);
      if (next == null || next === at) break;
      at = next;
    }
  }
  return total;
}
