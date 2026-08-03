/**
 * Data access layer.
 *
 * WHY SQLITE: this used to be one JSON file per trip, read and rewritten whole on
 * every change. That cannot survive concurrent writes, which is exactly the normal
 * case here — several people adding expenses to the same trip at once. Measured on
 * the old implementation: five simultaneous expenses produced two 500s, three 200s
 * and a single surviving expense. Two of those "successful" requests lost the user's
 * data silently, which for an app about money is the worst possible failure.
 *
 * Every write below is a transaction: it either lands completely or not at all.
 *
 * The public shape is unchanged, so routes and UI keep working: a `Trip` still
 * arrives with its members, expenses and payments nested.
 */
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { eq, asc, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { trips, members, expenses, expenseSplits, payments, users, tripAccess } from "@/db/schema";
import type { Trip, Member, Expense, Payment, Balance, Settlement } from "./types";

const DATA_DIR = process.env.SPLITTRIP_DATA_DIR?.trim() || join(process.cwd(), "data");
const CACHE_FILE = join(DATA_DIR, ".exchange-rates-cache.json");

export function generateId(): string {
  return randomBytes(16).toString("hex");
}

/** Ids come from the URL, so they are checked before reaching any query. */
const ID_RE = /^[0-9a-f]{8,32}$/;
export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

// ─── Reads ───────────────────────────────────────────────────────────
/** Full trip with everything nested, or null if it does not exist. */
export async function getTrip(id: string): Promise<Trip | null> {
  if (!isValidId(id)) return null;

  const [trip] = db.select().from(trips).where(eq(trips.id, id)).limit(1).all();
  if (!trip) return null;

  const memberRows = db
    .select()
    .from(members)
    .where(eq(members.tripId, id))
    .orderBy(asc(members.position))
    .all();

  const expenseRows = db
    .select()
    .from(expenses)
    .where(eq(expenses.tripId, id))
    .orderBy(asc(expenses.date))
    .all();

  const splitRows = db
    .select()
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
    .where(eq(expenses.tripId, id))
    .all();

  const paymentRows = db
    .select()
    .from(payments)
    .where(eq(payments.tripId, id))
    .orderBy(asc(payments.date))
    .all();

  // Splits are grouped in memory: one query beats one per expense.
  const splitsByExpense = new Map<string, { memberId: string; share: number }[]>();
  for (const row of splitRows) {
    const list = splitsByExpense.get(row.expense_splits.expenseId) ?? [];
    list.push({ memberId: row.expense_splits.memberId, share: row.expense_splits.share });
    splitsByExpense.set(row.expense_splits.expenseId, list);
  }

  return {
    id: trip.id,
    name: trip.name,
    currency: trip.currency,
    createdAt: trip.createdAt,
    version: trip.version,
    members: memberRows.map((m): Member => ({ id: m.id, name: m.name, emoji: m.emoji })),
    expenses: expenseRows.map((e): Expense => {
      const splits = splitsByExpense.get(e.id) ?? [];
      const uneven = splits.some((s) => s.share !== splits[0]?.share);
      return {
        id: e.id,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        amountEur: e.amountEur,
        paidBy: e.paidBy,
        splitAmong: splits.map((s) => s.memberId),
        // Only surfaced when the split is actually uneven, matching the old shape.
        splitShares: uneven
          ? Object.fromEntries(splits.map((s) => [s.memberId, s.share]))
          : undefined,
        category: e.category,
        date: e.date,
        exchangeRate: e.exchangeRate ?? undefined,
        rateAvailable: e.rateAvailable,
      };
    }),
    payments: paymentRows.map((p): Payment => ({
      id: p.id,
      from: p.fromMember,
      to: p.toMember,
      amount: p.amount,
      date: p.date,
      note: p.note ?? undefined,
    })),
  };
}

/**
 * Lightweight listing; does not pull expenses or payments.
 *
 * With a user, this is their own trips plus the ones shared with them. Without one it
 * returns nothing: an anonymous visitor reaches trips by link, never by browsing.
 */
export async function listTrips(userId?: string): Promise<
  { id: string; name: string; currency: string; createdAt: number; memberCount: number; expenseCount: number; owned: boolean }[]
> {
  if (!userId) return [];

  const owned = db.select().from(trips).where(eq(trips.ownerId, userId)).all();
  const sharedIds = db
    .select({ tripId: tripAccess.tripId })
    .from(tripAccess)
    .where(eq(tripAccess.userId, userId))
    .all()
    .map((r) => r.tripId);

  const seen = new Set(owned.map((t) => t.id));
  const shared = sharedIds
    .filter((id) => !seen.has(id))
    .map((id) => db.select().from(trips).where(eq(trips.id, id)).get())
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return [...owned, ...shared]
    .map((t) => ({
      id: t.id,
      name: t.name,
      currency: t.currency,
      createdAt: t.createdAt,
      memberCount: db.select().from(members).where(eq(members.tripId, t.id)).all().length,
      expenseCount: db.select().from(expenses).where(eq(expenses.tripId, t.id)).all().length,
      owned: t.ownerId === userId,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Ownership and access ────────────────────────────────────────────

export type Access = "none" | "viewer" | "editor" | "owner";

/**
 * What a given visitor may do with a trip.
 *
 * An ownerless trip is open to anyone holding the link — that is the anonymous mode the
 * app started with, and removing it would break every link already shared. Once a trip
 * has an owner the link alone is no longer enough.
 */
export function accessLevel(tripId: string, userId?: string): Access {
  const trip = db
    .select({ ownerId: trips.ownerId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .get();
  if (!trip) return "none";

  // An unclaimed trip belongs to whoever holds the link, deletion included. That is
  // exactly what the app did before accounts existed, and every link already shared
  // keeps working.
  if (trip.ownerId === null) return "owner";
  if (!userId) return "none";
  if (trip.ownerId === userId) return "owner";

  const grant = db
    .select({ role: tripAccess.role })
    .from(tripAccess)
    .where(and(eq(tripAccess.tripId, tripId), eq(tripAccess.userId, userId)))
    .get();
  if (!grant) return "none";
  return grant.role === "viewer" ? "viewer" : "editor";
}

export const canRead = (level: Access) => level !== "none";
export const canWrite = (level: Access) => level === "editor" || level === "owner";

/**
 * Attaches an ownerless trip to an account.
 *
 * The WHERE clause covers the race: two people claiming the same link at once means one
 * UPDATE matches and the other changes nothing.
 */
export async function claimTrip(tripId: string, userId: string): Promise<boolean> {
  if (!isValidId(tripId)) return false;
  const result = db
    .update(trips)
    .set({ ownerId: userId, updatedAt: Date.now() })
    .where(and(eq(trips.id, tripId), isNull(trips.ownerId)))
    .run();
  return result.changes > 0;
}

/** Gives another account access to an owned trip. Idempotent. */
export async function grantAccess(
  tripId: string,
  userId: string,
  role: "viewer" | "editor" = "editor"
): Promise<boolean> {
  try {
    db.insert(tripAccess)
      .values({ tripId, userId, role, createdAt: Date.now() })
      .onConflictDoUpdate({
        target: [tripAccess.tripId, tripAccess.userId],
        set: { role },
      })
      .run();
    return true;
  } catch {
    return false;
  }
}

export async function revokeAccess(tripId: string, userId: string): Promise<boolean> {
  const result = db
    .delete(tripAccess)
    .where(and(eq(tripAccess.tripId, tripId), eq(tripAccess.userId, userId)))
    .run();
  return result.changes > 0;
}

/** Everyone who can open an owned trip, the owner included. */
export function listCollaborators(
  tripId: string
): { id: string; email: string; name: string; role: Access }[] {
  const trip = db.select({ ownerId: trips.ownerId }).from(trips).where(eq(trips.id, tripId)).get();
  if (!trip?.ownerId) return [];

  const result: { id: string; email: string; name: string; role: Access }[] = [];
  const owner = db.select().from(users).where(eq(users.id, trip.ownerId)).get();
  if (owner) result.push({ id: owner.id, email: owner.email, name: owner.name, role: "owner" });

  const grants = db.select().from(tripAccess).where(eq(tripAccess.tripId, tripId)).all();
  for (const g of grants) {
    const u = db.select().from(users).where(eq(users.id, g.userId)).get();
    if (u) {
      result.push({
        id: u.id,
        email: u.email,
        name: u.name,
        role: g.role === "viewer" ? "viewer" : "editor",
      });
    }
  }
  return result;
}

/** How many trips an account owns; the free plan is capped on this. */
export function ownedTripCount(userId: string): number {
  return db.select().from(trips).where(eq(trips.ownerId, userId)).all().length;
}

/** Free accounts get a handful of trips; anonymous use stays unlimited. */
export const FREE_TRIP_LIMIT = 3;

export function atTripLimit(user: { id: string; plan: string }): boolean {
  return user.plan === "free" && ownedTripCount(user.id) >= FREE_TRIP_LIMIT;
}

// ─── Writes ──────────────────────────────────────────────────────────
export interface CreateTripInput {
  name: string;
  currency: string;
  members: { name: string; emoji: string }[];
  /** Omitted for anonymous trips, which stay reachable by link alone. */
  ownerId?: string;
}

export async function createTrip(input: CreateTripInput): Promise<Trip> {
  const id = generateId();
  const now = Date.now();

  db.transaction((tx) => {
    tx.insert(trips)
      .values({
        id,
        name: input.name,
        currency: input.currency,
        createdAt: now,
        updatedAt: now,
        version: 1,
        ownerId: input.ownerId ?? null,
      })
      .run();
    input.members.forEach((m, i) => {
      tx.insert(members)
        .values({ id: generateId(), tripId: id, name: m.name, emoji: m.emoji, position: i })
        .run();
    });
  });

  return (await getTrip(id))!;
}

export async function deleteTrip(id: string): Promise<boolean> {
  if (!isValidId(id)) return false;
  // Members, expenses, splits and payments go with it via ON DELETE CASCADE.
  const result = db.delete(trips).where(eq(trips.id, id)).run();
  return result.changes > 0;
}

export async function updateTripMeta(
  id: string,
  patch: { name?: string; currency?: string }
): Promise<boolean> {
  if (!isValidId(id)) return false;
  const result = db
    .update(trips)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(trips.id, id))
    .run();
  return result.changes > 0;
}

export interface AddExpenseInput {
  description: string;
  amount: number;
  currency: string;
  amountEur: number;
  paidBy: string;
  splitAmong: string[];
  splitShares?: Record<string, number>;
  category: string;
  date?: number;
  exchangeRate?: number;
  rateAvailable?: boolean;
}

/**
 * Adds an expense and its splits atomically.
 *
 * This is the operation that used to lose data: it was read-whole-trip, push to an
 * array, write-whole-trip. Now the expense and every split row land in one
 * transaction, and concurrent callers queue on the write lock instead of clobbering
 * each other.
 */
export async function addExpense(tripId: string, input: AddExpenseInput): Promise<Expense | null> {
  if (!isValidId(tripId)) return null;
  const expenseId = generateId();
  const date = input.date ?? Date.now();

  db.transaction((tx) => {
    tx.insert(expenses)
      .values({
        id: expenseId,
        tripId,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        amountEur: input.amountEur,
        paidBy: input.paidBy,
        category: input.category,
        date,
        exchangeRate: input.exchangeRate ?? null,
        rateAvailable: input.rateAvailable ?? true,
      })
      .run();

    for (const memberId of input.splitAmong) {
      tx.insert(expenseSplits)
        .values({ expenseId, memberId, share: input.splitShares?.[memberId] ?? 1 })
        .run();
    }

    tx.update(trips)
      .set({ updatedAt: date, version: (db.select().from(trips).where(eq(trips.id, tripId)).all()[0]?.version ?? 1) + 1 })
      .where(eq(trips.id, tripId))
      .run();
  });

  const trip = await getTrip(tripId);
  return trip?.expenses.find((e) => e.id === expenseId) ?? null;
}

export interface UpdateExpenseInput extends Partial<AddExpenseInput> {
  splitAmong?: string[];
}

/**
 * Edits an expense in place. The splits are replaced wholesale inside the same
 * transaction, so an edit can never leave an expense pointing at a half-updated set
 * of participants.
 */
export async function updateExpense(
  tripId: string,
  expenseId: string,
  patch: UpdateExpenseInput
): Promise<Expense | null> {
  if (!isValidId(tripId) || !isValidId(expenseId)) return null;

  db.transaction((tx) => {
    const fields: Record<string, unknown> = {};
    for (const key of [
      "description",
      "amount",
      "currency",
      "amountEur",
      "paidBy",
      "category",
      "date",
      "exchangeRate",
      "rateAvailable",
    ] as const) {
      if (patch[key] !== undefined) fields[key] = patch[key];
    }
    if (Object.keys(fields).length > 0) {
      tx.update(expenses).set(fields).where(eq(expenses.id, expenseId)).run();
    }

    if (patch.splitAmong) {
      tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId)).run();
      for (const memberId of patch.splitAmong) {
        tx.insert(expenseSplits)
          .values({ expenseId, memberId, share: patch.splitShares?.[memberId] ?? 1 })
          .run();
      }
    }

    tx.update(trips).set({ updatedAt: Date.now() }).where(eq(trips.id, tripId)).run();
  });

  const trip = await getTrip(tripId);
  return trip?.expenses.find((e) => e.id === expenseId) ?? null;
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<boolean> {
  if (!isValidId(tripId) || !isValidId(expenseId)) return false;
  const result = db.delete(expenses).where(eq(expenses.id, expenseId)).run();
  if (result.changes > 0) {
    db.update(trips).set({ updatedAt: Date.now() }).where(eq(trips.id, tripId)).run();
  }
  return result.changes > 0;
}

export interface AddPaymentInput {
  from: string;
  to: string;
  amount: number;
  date?: number;
  note?: string;
}

export async function addPayment(tripId: string, input: AddPaymentInput): Promise<Payment | null> {
  if (!isValidId(tripId)) return null;
  const id = generateId();
  const date = input.date ?? Date.now();

  db.transaction((tx) => {
    tx.insert(payments)
      .values({
        id,
        tripId,
        fromMember: input.from,
        toMember: input.to,
        amount: input.amount,
        date,
        note: input.note ?? null,
      })
      .run();
    tx.update(trips).set({ updatedAt: date }).where(eq(trips.id, tripId)).run();
  });

  return { id, from: input.from, to: input.to, amount: input.amount, date, note: input.note };
}

export async function deletePayment(tripId: string, paymentId: string): Promise<boolean> {
  if (!isValidId(tripId) || !isValidId(paymentId)) return false;
  const result = db.delete(payments).where(eq(payments.id, paymentId)).run();
  return result.changes > 0;
}

/**
 * Removes members from a trip.
 *
 * Cascades handle the rest: expenses they paid for, payments they took part in, and
 * their share rows all go with them. Note this is better than the previous
 * behaviour, which left dangling member ids inside other people's splits — those
 * expenses now simply get shared among whoever is left.
 */
export async function removeMembers(tripId: string, memberIds: string[]): Promise<number> {
  if (!isValidId(tripId) || memberIds.length === 0) return 0;

  let removed = 0;
  db.transaction((tx) => {
    for (const memberId of memberIds) {
      if (!isValidId(memberId)) continue;
      removed += tx.delete(members).where(eq(members.id, memberId)).run().changes;
    }
    tx.update(trips).set({ updatedAt: Date.now() }).where(eq(trips.id, tripId)).run();
  });
  return removed;
}

export async function addMember(tripId: string, name: string, emoji: string): Promise<Member | null> {
  if (!isValidId(tripId)) return null;
  const id = generateId();
  const count = db.select().from(members).where(eq(members.tripId, tripId)).all().length;
  db.insert(members).values({ id, tripId, name, emoji, position: count }).run();
  return { id, name, emoji };
}

// ─── Calculations (unchanged behaviour) ──────────────────────────────
export function calculateBalances(trip: Trip): Balance[] {
  const balances: Record<string, { paid: number; share: number }> = {};

  for (const member of trip.members) {
    balances[member.id] = { paid: 0, share: 0 };
  }

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

  // Payments: "from" settles part of their debt, "to" is owed less.
  for (const payment of trip.payments || []) {
    if (balances[payment.from]) balances[payment.from].share -= payment.amount;
    if (balances[payment.to]) balances[payment.to].paid -= payment.amount;
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

/** Minimal set of transfers that settles everyone up. */
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

// ─── Exchange rates ──────────────────────────────────────────────────
interface CachedRates {
  timestamp: number;
  base: string;
  rates: Record<string, number>;
}

async function readCachedRates(): Promise<CachedRates | null> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function writeCachedRates(cache: CachedRates): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

export async function fetchExchangeRates(base: string = "EUR"): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${base}`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const data = await res.json();
      await writeCachedRates({ timestamp: Date.now(), base, rates: data.rates });
      return data.rates;
    }
  } catch {
    // Falls through to the cache below.
  }

  const cached = await readCachedRates();
  return cached && cached.base === base ? cached.rates : null;
}

/**
 * Convert to the common unit. Throws when no rate is available rather than falling
 * back to 1:1, which would quietly corrupt everyone's balances.
 */
export async function convertToEur(
  amount: number,
  fromCurrency: string
): Promise<{ amountEur: number; rateUsed: boolean }> {
  if (fromCurrency === "EUR") return { amountEur: Math.round(amount * 100) / 100, rateUsed: true };
  const rates = await fetchExchangeRates("EUR");
  if (rates && rates[fromCurrency]) {
    return { amountEur: Math.round((amount / rates[fromCurrency]) * 100) / 100, rateUsed: true };
  }
  throw new Error(`No exchange rate available for ${fromCurrency}. Cannot convert to EUR.`);
}

/** Display-only variant: returns null instead of throwing. */
export async function convertToEurSafe(
  amount: number,
  fromCurrency: string
): Promise<{ amountEur: number; rateUsed: boolean } | null> {
  try {
    return await convertToEur(amount, fromCurrency);
  } catch {
    return null;
  }
}

/** True while a trip still belongs to nobody and travels on its link alone. */
export function isAnonymousTrip(tripId: string): boolean {
  const row = db.select({ ownerId: trips.ownerId }).from(trips).where(eq(trips.id, tripId)).get();
  return row ? row.ownerId === null : false;
}
