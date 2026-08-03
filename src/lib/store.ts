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
import {
  trips,
  members,
  expenses,
  expenseSplits,
  payments,
  users,
  tripAccess,
  invites,
  recurring,
} from "@/db/schema";
import type { Trip, Member, Expense, Payment } from "./types";

const DATA_DIR = process.env.TABUP_DATA_DIR?.trim() || join(process.cwd(), "data");
const CACHE_FILE = join(DATA_DIR, ".exchange-rates-cache.json");

// The maths lives in balances.ts because the browser needs it as well; re-exported here
// so every existing importer keeps working unchanged.
export { calculateBalances, calculateSettlements } from "./balances";

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
    budget: trip.budget,
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
        note: e.note ?? undefined,
        receipt: e.receipt ?? undefined,
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

/**
 * How many trips a free account may own. Unlimited unless `TABUP_FREE_TRIP_LIMIT`
 * says otherwise.
 *
 * There used to be a hard cap of three. It saved no storage worth the name and it is
 * precisely the sort of invented scarcity that people resent in Splitwise, whose free
 * tier stops at a few expenses a day. If this ever becomes a paid product, the thing
 * worth charging for is what costs money to run, not permission to keep using it.
 */
export const FREE_TRIP_LIMIT: number | null = (() => {
  const raw = process.env.TABUP_FREE_TRIP_LIMIT?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
})();

export function atTripLimit(user: { id: string; plan: string }): boolean {
  if (FREE_TRIP_LIMIT === null || user.plan !== "free") return false;
  return ownedTripCount(user.id) >= FREE_TRIP_LIMIT;
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
  patch: { name?: string; currency?: string; budget?: number | null }
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
  note?: string;
  receipt?: string;
  /** Idempotency key from the client; see the schema for why. */
  clientId?: string;
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

  // A retry of a write that already landed must return what was stored, not add a
  // second copy of it. Checked before inserting, and the unique index catches the
  // narrow race where two retries arrive at once.
  if (input.clientId) {
    const existing = await findExpenseByClientId(tripId, input.clientId);
    if (existing) return existing;
  }

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
        note: input.note ?? null,
        receipt: input.receipt ?? null,
        clientId: input.clientId ?? null,
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
  /** Idempotency key from the client. */
  clientId?: string;
  from: string;
  to: string;
  amount: number;
  date?: number;
  note?: string;
}

export async function addPayment(tripId: string, input: AddPaymentInput): Promise<Payment | null> {
  if (!isValidId(tripId)) return null;

  if (input.clientId) {
    const existing = db
      .select()
      .from(payments)
      .where(and(eq(payments.tripId, tripId), eq(payments.clientId, input.clientId)))
      .get();
    if (existing) {
      return {
        id: existing.id,
        from: existing.fromMember,
        to: existing.toMember,
        amount: existing.amount,
        date: existing.date,
        note: existing.note ?? undefined,
      };
    }
  }

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
        clientId: input.clientId ?? null,
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


/**
 * Finds an expense already written under a given client id.
 *
 * Used to make retries of queued offline writes idempotent: the caller gets back what
 * was stored the first time instead of creating a duplicate charge.
 */
export async function findExpenseByClientId(
  tripId: string,
  clientId: string
): Promise<Expense | null> {
  const row = db
    .select()
    .from(expenses)
    .where(and(eq(expenses.tripId, tripId), eq(expenses.clientId, clientId)))
    .get();
  if (!row) return null;

  const splits = db
    .select()
    .from(expenseSplits)
    .where(eq(expenseSplits.expenseId, row.id))
    .all();
  const uneven = splits.some((sp) => sp.share !== splits[0]?.share);

  return {
    id: row.id,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    amountEur: row.amountEur,
    paidBy: row.paidBy,
    splitAmong: splits.map((sp) => sp.memberId),
    splitShares: uneven
      ? Object.fromEntries(splits.map((sp) => [sp.memberId, sp.share]))
      : undefined,
    category: row.category,
    date: row.date,
    exchangeRate: row.exchangeRate ?? undefined,
    rateAvailable: row.rateAvailable,
    note: row.note ?? undefined,
    receipt: row.receipt ?? undefined,
  };
}

// ─── Invitations ─────────────────────────────────────────────────────

/** A week is long enough for a trip to be planned and short enough to stop mattering. */
const INVITE_DAYS = 7;

/**
 * Creates an invitation link for an owned trip.
 *
 * Anonymous trips do not need one — their link already lets anyone in — so this is
 * only ever reached for a trip that has an owner.
 */
export async function createInvite(
  tripId: string,
  role: "viewer" | "editor" = "editor"
): Promise<{ token: string; expiresAt: number } | null> {
  if (!isValidId(tripId)) return null;

  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const expiresAt = now + INVITE_DAYS * 24 * 60 * 60 * 1000;

  db.insert(invites).values({ token, tripId, role, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
}

export interface InviteDetails {
  tripId: string;
  tripName: string;
  role: "viewer" | "editor";
}

/** Looks up a token, treating an expired one as if it never existed. */
export function readInvite(token: string): InviteDetails | null {
  if (!token || token.length > 64) return null;

  const invite = db.select().from(invites).where(eq(invites.token, token)).get();
  if (!invite || invite.expiresAt < Date.now()) return null;

  const trip = db
    .select({ name: trips.name })
    .from(trips)
    .where(eq(trips.id, invite.tripId))
    .get();
  if (!trip) return null;

  return {
    tripId: invite.tripId,
    tripName: trip.name,
    role: invite.role === "viewer" ? "viewer" : "editor",
  };
}

/**
 * Redeems an invitation for a user.
 *
 * The token is deliberately not consumed: a trip link gets forwarded around a group,
 * and a single-use invite would work for whoever tapped first and leave everyone else
 * with an error they cannot explain. The expiry is what bounds it.
 */
export async function redeemInvite(token: string, userId: string): Promise<string | null> {
  const invite = readInvite(token);
  if (!invite) return null;

  // The owner opening their own link should not be demoted to editor.
  const current = accessLevel(invite.tripId, userId);
  if (current === "owner") return invite.tripId;

  const granted = await grantAccess(invite.tripId, userId, invite.role);
  return granted ? invite.tripId : null;
}

// ─── Recurring expenses ──────────────────────────────────────────────

/**
 * Subscriptions, insurance, rent.
 *
 * Always scoped to a user: unlike a trip, these have nobody to share with and no link
 * that grants access. Every query below filters by userId rather than trusting the id.
 */
export async function listRecurring(userId: string): Promise<RecurringItem[]> {
  return db
    .select()
    .from(recurring)
    .where(eq(recurring.userId, userId))
    .all()
    .map(toRecurring)
    // Active first, then by what they cost per month.
    .sort((a, b) => {
      const activeA = a.endedAt == null ? 0 : 1;
      const activeB = b.endedAt == null ? 0 : 1;
      return activeA - activeB || b.amountBase - a.amountBase;
    });
}

export interface RecurringInput {
  name: string;
  amount: number;
  currency: string;
  amountBase: number;
  period: string;
  chargeDay: number;
  chargeMonth?: number | null;
  category: string;
  startedAt: number;
  endedAt?: number | null;
  note?: string | null;
}

export async function addRecurring(
  userId: string,
  input: RecurringInput
): Promise<RecurringItem | null> {
  const id = generateId();
  db.insert(recurring)
    .values({ id, userId, ...input, createdAt: Date.now() })
    .run();

  const row = db.select().from(recurring).where(eq(recurring.id, id)).get();
  return row ? toRecurring(row) : null;
}

export async function updateRecurring(
  userId: string,
  id: string,
  patch: Partial<RecurringInput>
): Promise<boolean> {
  const result = db
    .update(recurring)
    .set(patch)
    .where(and(eq(recurring.id, id), eq(recurring.userId, userId)))
    .run();
  return result.changes > 0;
}

export async function deleteRecurring(userId: string, id: string): Promise<boolean> {
  const result = db
    .delete(recurring)
    .where(and(eq(recurring.id, id), eq(recurring.userId, userId)))
    .run();
  return result.changes > 0;
}

type RecurringItem = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  amountBase: number;
  period: "weekly" | "monthly" | "quarterly" | "yearly";
  chargeDay: number;
  chargeMonth?: number | null;
  category: string;
  startedAt: number;
  endedAt?: number | null;
  note?: string | null;
};

function toRecurring(row: typeof recurring.$inferSelect): RecurringItem {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    currency: row.currency,
    amountBase: row.amountBase,
    period: (["weekly", "monthly", "quarterly", "yearly"] as const).includes(
      row.period as "monthly"
    )
      ? (row.period as RecurringItem["period"])
      : "monthly",
    chargeDay: row.chargeDay,
    chargeMonth: row.chargeMonth,
    category: row.category,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    note: row.note,
  };
}
