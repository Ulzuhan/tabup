import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";

/**
 * Exchange rates, and the one rule that matters: never invent one.
 *
 * Rates come from Frankfurter, which serves the European Central Bank's daily reference
 * rates, quoted against the euro. A conversion between any two currencies goes through
 * the euro — arithmetic on the way past, not a claim that euros are the unit anything is
 * stored in. A trip in pesos stores pesos.
 *
 * Two things this module is careful about, because both were wrong before:
 *
 *   **The day.** An expense carries a date and can be backdated, so last month's dinner
 *   is converted at last month's rate rather than today's. Historical rates never change,
 *   which is what makes them worth caching forever.
 *
 *   **Saying when it is guessing.** A cached rate that has gone stale, or today's rate
 *   standing in for a day we could not fetch, still converts — refusing would leave
 *   somebody unable to record what they spent — but it comes back marked, and that mark
 *   ends up on the expense and on the screen. A figure the app is unsure about must not
 *   look like one it is sure about.
 */

const DATA_DIR = resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.TABUP_DATA_DIR?.trim() || "data"
);
const CACHE_FILE = resolve(DATA_DIR, ".exchange-rates-cache.json");

/**
 * How long a cached "latest" may stand in before it is called approximate.
 *
 * Not how often it refreshes — that happens on every conversion when the network is
 * there. This is only reached when Frankfurter cannot be contacted at all, and a day
 * without any contact is the point where "today's rate" stops being a fair description.
 */
const STALE_AFTER = 24 * 60 * 60 * 1000;

type Rates = Record<string, number>;

interface RateCache {
  /** The most recent live table, and when *we* fetched it. */
  latest?: { fetchedAt: number; rates: Rates };
  /** Keyed by ISO day. These never change, so they are kept for good. */
  historical?: Record<string, Rates>;
}

async function readCache(): Promise<RateCache> {
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    // The file used to be a single `{ timestamp, base, rates }`. Read it rather than
    // throw it away: it is a perfectly good "latest" and refetching costs a round trip.
    if (parsed && parsed.rates && !parsed.latest) {
      return { latest: { fetchedAt: parsed.timestamp ?? 0, rates: parsed.rates }, historical: {} };
    }
    return { latest: parsed?.latest, historical: parsed?.historical ?? {} };
  } catch {
    return { historical: {} };
  }
}

async function writeCache(cache: RateCache): Promise<void> {
  try {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    // A cache that cannot be written is slower, not broken.
    console.error("Could not write the exchange-rate cache:", error);
  }
}

/** Local calendar day, which is the day a person means when they date an expense. */
export function isoDay(when: number | Date = Date.now()): string {
  const date = new Date(when);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export interface RateTable {
  rates: Rates;
  /** Whether these are the rates that were asked for, or the nearest thing to hand. */
  exact: boolean;
  /** When the table was fetched, for anything that wants to show its age. */
  fetchedAt: number;
}

/**
 * The euro-based table for a given day, or for today.
 *
 * A past day is asked for by date and then kept for good — the euro/dollar rate for the
 * 14th of July does not get revised. Today's is refetched whenever the network allows,
 * and falls back to whatever was last seen.
 */
export async function ratesFor(day?: string): Promise<RateTable | null> {
  const today = isoDay();
  const wantsHistory = Boolean(day && day < today);
  const cache = await readCache();

  if (wantsHistory) {
    const kept = cache.historical?.[day!];
    if (kept) return { rates: kept, exact: true, fetchedAt: 0 };

    const fetched = await fetchTable(day!);
    if (fetched) {
      await writeCache({
        ...cache,
        historical: { ...(cache.historical ?? {}), [day!]: fetched },
      });
      return { rates: fetched, exact: true, fetchedAt: Date.now() };
    }
    // No table for that day and no way to get one. Today's rate is better than refusing
    // to record the expense at all, but it is not the rate that applied, so say so.
    const fallback = await ratesFor();
    return fallback && { ...fallback, exact: false };
  }

  const fetched = await fetchTable("latest");
  if (fetched) {
    const fetchedAt = Date.now();
    await writeCache({ ...cache, latest: { fetchedAt, rates: fetched } });
    return { rates: fetched, exact: true, fetchedAt };
  }

  if (!cache.latest) return null;
  return {
    rates: cache.latest.rates,
    exact: Date.now() - cache.latest.fetchedAt < STALE_AFTER,
    fetchedAt: cache.latest.fetchedAt,
  };
}

async function fetchTable(day: string): Promise<Rates | null> {
  try {
    const res = await fetch(`https://api.frankfurter.app/${day}?from=EUR`, {
      // Today's table is worth re-asking for through the day; a past one never changes.
      next: { revalidate: day === "latest" ? 3600 : 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rates ?? null;
  } catch {
    return null;
  }
}

/** What `/api/rates` serves, and what the rest of the app used to call directly. */
export async function fetchExchangeRates(): Promise<RateTable | null> {
  return ratesFor();
}

export interface Conversion {
  amount: number;
  /**
   * False when the figure came from a rate that is not the one that applied: a stale
   * cache, or today's table standing in for a day that could not be fetched. It ends up
   * on the expense as `rateAvailable` and puts a warning next to it on screen.
   */
  rateUsed: boolean;
}

/**
 * Converts between any two currencies, as of a given day.
 *
 * Throws when there is no table at all rather than falling back to 1:1, which would
 * quietly corrupt everyone's balances. An approximate rate is reported, not hidden; no
 * rate is refused.
 */
export async function convertTo(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  /** When the money was spent. Defaults to now. */
  on?: number
): Promise<Conversion> {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (fromCurrency === toCurrency) return { amount: round(amount), rateUsed: true };

  const table = await ratesFor(on ? isoDay(on) : undefined);
  if (!table) throw new Error(`No exchange rate available for ${fromCurrency} → ${toCurrency}.`);

  // The base of the table is not listed in it, so euros are added here rather than
  // special-cased at every use.
  const rate = (code: string) => (code === "EUR" ? 1 : table.rates[code]);
  const from = rate(fromCurrency);
  const to = rate(toCurrency);
  if (!from || !to) {
    throw new Error(`No exchange rate available for ${fromCurrency} → ${toCurrency}.`);
  }

  return { amount: round((amount / from) * to), rateUsed: table.exact };
}

/** Display-only variant: returns null instead of throwing. */
export async function convertToSafe(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  on?: number
): Promise<Conversion | null> {
  try {
    return await convertTo(amount, fromCurrency, toCurrency, on);
  } catch {
    return null;
  }
}
