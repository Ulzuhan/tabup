import { randomBytes } from "crypto";
import { readFile, writeFile, mkdir, unlink, rename, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { Trip, Settlement, Balance } from "./types";

const DATA_DIR = join(process.cwd(), ".splittrip-data");
const CACHE_FILE = join(DATA_DIR, ".exchange-rates-cache.json");

function tripPath(id: string) {
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    throw new Error(`Invalid trip ID format: ${id}`);
  }
  const resolved = join(DATA_DIR, `${id}.json`);
  if (!resolved.startsWith(DATA_DIR)) {
    throw new Error(`Path traversal detected`);
  }
  return resolved;
}

export async function createTrip(trip: Trip): Promise<Trip> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(tripPath(trip.id), JSON.stringify(trip, null, 2));
  return trip;
}

export async function getTrip(id: string): Promise<Trip | null> {
  try {
    const raw = await readFile(tripPath(id), "utf-8");
    const trip = JSON.parse(raw) as Trip;
    let needsSave = false;
    if (!trip.version) { trip.version = 1; needsSave = true; }
    if (!trip.payments) { trip.payments = []; needsSave = true; }
    if (needsSave) await updateTrip(trip);
    return trip;
  } catch {
    return null;
  }
}

export async function updateTrip(trip: Trip): Promise<Trip> {
  const targetPath = tripPath(trip.id);
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(trip, null, 2));
  await rename(tmpPath, targetPath);
  return trip;
}

export async function deleteTrip(id: string): Promise<boolean> {
  try {
    await unlink(tripPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function listTrips(): Promise<Trip[]> {
  if (!existsSync(DATA_DIR)) return [];
  const files = await readdir(DATA_DIR);
  const trips: Trip[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    try {
      const raw = await readFile(join(DATA_DIR, file), "utf-8");
      trips.push(JSON.parse(raw));
    } catch {}
  }
  return trips.sort((a, b) => b.createdAt - a.createdAt);
}

export function generateId(): string {
  return randomBytes(16).toString("hex");
}

// Calculate balances — expenses + payments
export function calculateBalances(trip: Trip): Balance[] {
  const balances: Record<string, { paid: number; share: number }> = {};

  for (const member of trip.members) {
    balances[member.id] = { paid: 0, share: 0 };
  }

  // Expenses: who paid and who owes
  for (const expense of trip.expenses) {
    if (balances[expense.paidBy]) {
      balances[expense.paidBy].paid += expense.amountEur;
    }
    const splitCount = expense.splitAmong.length;
    if (splitCount > 0) {
      const shares = expense.splitShares;
      if (shares && Object.keys(shares).length > 0) {
        const totalWeight = Object.values(shares).reduce((s, w) => s + w, 0);
        if (totalWeight > 0) {
          for (const memberId of expense.splitAmong) {
            if (balances[memberId] && shares[memberId]) {
              balances[memberId].share += (expense.amountEur * shares[memberId]) / totalWeight;
            }
          }
        }
      } else {
        const sharePerPerson = expense.amountEur / splitCount;
        for (const memberId of expense.splitAmong) {
          if (balances[memberId]) {
            balances[memberId].share += sharePerPerson;
          }
        }
      }
    }
  }

  // Payments: "from" paid toward their debt → owes less, "to" received → is owed less
  for (const payment of trip.payments || []) {
    if (balances[payment.from]) {
      balances[payment.from].share -= payment.amount; // from owes less
    }
    if (balances[payment.to]) {
      balances[payment.to].paid -= payment.amount; // to is owed less
    }
  }

  return trip.members.map((member) => {
    const b = balances[member.id] || { paid: 0, share: 0 };
    return {
      memberId: member.id,
      totalPaid: Math.round(b.paid * 100) / 100,
      totalShare: Math.round(b.share * 100) / 100,
      balance: Math.round((b.paid - b.share) * 100) / 100,
    };
  });
}

// Calculate minimal settlements (after payments applied)
export function calculateSettlements(trip: Trip): Settlement[] {
  const balances = calculateBalances(trip);
  const settlements: Settlement[] = [];

  const creditors = balances.filter((b) => b.balance > 0.01).map((b) => ({ id: b.memberId, amount: b.balance }));
  const debtors = balances.filter((b) => b.balance < -0.01).map((b) => ({ id: b.memberId, amount: -b.balance }));

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0.01) {
      settlements.push({
        from: debtors[i].id,
        to: creditors[j].id,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return settlements;
}

// --- Exchange Rate Caching ---
interface CachedRates {
  timestamp: number;
  base: string;
  rates: Record<string, number>;
}

async function readCachedRates(): Promise<CachedRates | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCachedRates(cache: CachedRates): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

export async function fetchExchangeRates(base: string = "EUR"): Promise<Record<string, number> | null> {
  // Try live API first
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${base}`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const data = await res.json();
      const cache: CachedRates = { timestamp: Date.now(), base, rates: data.rates };
      await writeCachedRates(cache);
      return data.rates;
    }
  } catch {}

  // API failed — use last cached rates from disk
  const cached = await readCachedRates();
  if (cached && cached.base === base) {
    return cached.rates;
  }

  return null;
}

/** Convert an amount from a foreign currency to EUR.
 *  Returns { amountEur, rateUsed: true } on success.
 *  Throws Error if the rate is unavailable — callers should catch and handle. */
export async function convertToEur(amount: number, fromCurrency: string): Promise<{ amountEur: number; rateUsed: boolean }> {
  if (fromCurrency === "EUR") return { amountEur: Math.round(amount * 100) / 100, rateUsed: true };
  const rates = await fetchExchangeRates("EUR");
  if (rates && rates[fromCurrency]) {
    return { amountEur: Math.round((amount / rates[fromCurrency]) * 100) / 100, rateUsed: true };
  }
  // No rate available — throw error instead of silently using 1:1 fallback
  throw new Error(`No exchange rate available for ${fromCurrency}. Cannot convert to EUR.`);
}

/** Safe conversion for display purposes only — returns null if rate unavailable */
export async function convertToEurSafe(amount: number, fromCurrency: string): Promise<{ amountEur: number; rateUsed: boolean } | null> {
  try {
    return await convertToEur(amount, fromCurrency);
  } catch {
    return null;
  }
}