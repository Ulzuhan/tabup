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
import { eq, asc, desc, and, gt, isNull, sql } from "drizzle-orm";
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
  activity,
  comments,
} from "@/db/schema";
import { EMOJIS, isTripKind } from "./types";
import type { Trip, Member, Expense, Payment, TripKind } from "./types";

// The maths lives in balances.ts because the browser needs it as well; re-exported here
// so every existing importer keeps working unchanged.
export { calculateBalances, calculateSettlements } from "./balances";
// Rates live in rates.ts for the same reason they are worth separating at all: they are
// the one part of this file that talks to the outside world.
export { convertTo, convertToSafe, fetchExchangeRates, isoDay } from "./rates";
// Re-exporting does not bind them here, and the list of trips needs the balances itself.
import { calculateBalances } from "./balances";

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

  // Joined rather than fetched per member: the account's own name is what a linked
  // participant is called when nobody has set a different alias for this trip, and
  // whether they can still open the trip is the difference between somebody who is in it
  // and somebody who was.
  const memberRows = db
    .select({ member: members, accountName: users.name, grant: tripAccess.userId })
    .from(members)
    .leftJoin(users, eq(members.userId, users.id))
    .leftJoin(
      tripAccess,
      and(eq(tripAccess.tripId, members.tripId), eq(tripAccess.userId, members.userId))
    )
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
    kind: isTripKind(trip.kind) ? trip.kind : "trip",
    currency: trip.currency,
    budget: trip.budget,
    createdAt: trip.createdAt,
    version: trip.version,
    members: memberRows.map(
      ({ member: m, accountName, grant }): Member => ({
        id: m.id,
        name: m.name,
        emoji: m.emoji,
        userId: m.userId,
        accountName: accountName ?? undefined,
        // The owner holds no grant row — the trip is theirs — so they would otherwise
        // read as somebody who had been shown the door out of their own trip.
        inTrip: m.userId ? Boolean(grant) || m.userId === trip.ownerId : undefined,
      })
    ),
    expenses: expenseRows.map((e): Expense => {
      const splits = splitsByExpense.get(e.id) ?? [];
      const uneven = splits.some((s) => s.share !== splits[0]?.share);
      return {
        id: e.id,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        amountBase: e.amountBase,
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
      currency: p.currency,
      amountBase: p.amountBase,
      rateAvailable: p.rateAvailable,
      date: p.date,
      note: p.note ?? undefined,
    })),
  };
}

/**
 * The trips a person is in, each with the only figure they opened the app for.
 *
 * The list used to say "3 people · 5 expenses", which is true and answers nobody's
 * question. What anyone wants from a list of trips is whether they owe money or are owed
 * it, and the app has known which participant each reader is since members became
 * accounts — it simply was not using it here.
 *
 * The balance comes from `calculateBalances` over the whole trip rather than from a
 * cheaper aggregate query, on purpose: the maths is integer cents with a largest-
 * remainder apportionment, and a second implementation in SQL would be a second answer
 * about money, drifting quietly from the first. A handful of trips is a handful of local
 * SQLite reads.
 */
export async function listTrips(userId: string): Promise<
  {
    id: string;
    name: string;
    kind: TripKind;
    currency: string;
    createdAt: number;
    memberCount: number;
    expenseCount: number;
    owned: boolean;
    /** In the trip's currency. Null when the reader is in nobody's split yet. */
    balance: number | null;
  }[]
> {
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

  const rows = await Promise.all(
    [...owned, ...shared].map(async (t) => {
      const trip = await getTrip(t.id);
      const you = trip?.members.find((m) => m.userId === userId);
      const balance = you
        ? calculateBalances(trip!).find((b) => b.memberId === you.id)?.balance ?? 0
        : null;

      return {
        id: t.id,
        name: t.name,
        kind: isTripKind(t.kind) ? t.kind : "trip",
        currency: t.currency,
        createdAt: t.createdAt,
        memberCount: trip?.members.length ?? 0,
        expenseCount: trip?.expenses.length ?? 0,
        owned: t.ownerId === userId,
        balance,
      };
    })
  );

  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Ownership and access ────────────────────────────────────────────

export type Access = "none" | "member" | "owner";

/**
 * What a given visitor may do with a trip.
 *
 * Two levels, because there are two honest answers. The owner keeps the trip itself —
 * its name, its budget, who is in it, who may come in, whether it goes on existing.
 * Everyone else in it keeps their own share of the record: they add expenses and
 * payments, and may change the ones they entered.
 *
 * There were four, with "editor" and "viewer" in between, and they answered a different
 * question from the one anybody actually asks. Being an editor said nothing about being
 * in the split, so inviting a friend as one gave them the run of the trip while leaving
 * them out of every balance in it, and the owner then had to add them a second time, by
 * hand, as a name with no connection to their account. Two ideas of "who is in this
 * trip", disagreeing.
 *
 * Every trip belongs to an account. There is no anonymous mode: holding a link is not
 * access, and someone who has been given one joins through an invitation instead.
 */
export function accessLevel(tripId: string, userId?: string): Access {
  if (!userId) return "none";

  const trip = db
    .select({ ownerId: trips.ownerId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .get();
  if (!trip) return "none";
  if (trip.ownerId === userId) return "owner";

  const grant = db
    .select({ userId: tripAccess.userId })
    .from(tripAccess)
    .where(and(eq(tripAccess.tripId, tripId), eq(tripAccess.userId, userId)))
    .get();
  return grant ? "member" : "none";
}

export const canRead = (level: Access) => level !== "none";

/**
 * Whether they may add to the trip.
 *
 * The same answer as reading it, and deliberately so: everybody in a trip is one of the
 * people its bills are split between, and a participant who cannot enter what they paid
 * is not one. Changing something that is already there is a different question, asked
 * per row rather than per person — see `authorRule`.
 */
export const canWrite = (level: Access) => level !== "none";

/** Lets another account into a trip. Idempotent. */
export async function grantAccess(tripId: string, userId: string): Promise<boolean> {
  try {
    db.insert(tripAccess)
      .values({ tripId, userId, createdAt: Date.now() })
      .onConflictDoNothing({ target: [tripAccess.tripId, tripAccess.userId] })
      .run();
    return true;
  } catch {
    return false;
  }
}

/**
 * The address behind each seat that has an account, keyed by member id.
 *
 * For the owner only, and asked for separately rather than carried on the trip: an email
 * address is what the owner typed in order to invite somebody, and handing every guest
 * the address of everyone else at the table is a different act from splitting a bill
 * with them. Nothing else on screen needs it — a name and "has an account" is what the
 * list shows.
 *
 * This used to be a whole parallel list of "collaborators", which is what made the trip
 * appear to have two sets of people in it. There is one set; this is a detail of it.
 */
export function memberEmails(tripId: string): Record<string, string> {
  const rows = db
    .select({ memberId: members.id, email: users.email })
    .from(members)
    .innerJoin(users, eq(members.userId, users.id))
    .where(eq(members.tripId, tripId))
    .all();
  return Object.fromEntries(rows.map((r) => [r.memberId, r.email]));
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

/**
 * Marks a trip as changed.
 *
 * Every write goes through this rather than setting `updatedAt` by hand, because the
 * version used to be bumped in one single place — adding an expense — so an edit, a
 * deletion or a settle-up left it behind. A version that only sometimes moves is worse
 * than none at all: anything trusting it to notice stale data would be told, wrongly,
 * that nothing had happened.
 */
type Writer = Pick<typeof db, "update">;

function touchTrip(writer: Writer, tripId: string): void {
  writer
    .update(trips)
    .set({ updatedAt: Date.now(), version: sql`${trips.version} + 1` })
    .where(eq(trips.id, tripId))
    .run();
}

/**
 * Whether a row belongs to the trip it is being changed through.
 *
 * Authorisation is per trip, and every id below arrives in a request body rather than
 * in the URL that was authorised. Without this pairing, write access to any one trip
 * was write access to every row in the database whose id you happened to know — and a
 * read-only guest is handed the ids of everything they can see.
 */
function belongsToTrip(
  table: typeof expenses | typeof payments | typeof members,
  rowId: string,
  tripId: string
): boolean {
  return Boolean(
    db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, rowId), eq(table.tripId, tripId)))
      .get()
  );
}

export type AuthorCheck = "ok" | "missing" | "forbidden";

/**
 * Whether this caller may change a row that somebody else may have written.
 *
 * Everyone in a trip can add expenses, and each answers for what they added. The owner
 * can change anything, because it is their trip and somebody has to be able to fix a
 * figure left behind by a person who has gone.
 *
 * A row with no author — everything written before this was recorded, and anything left
 * by a deleted account — belongs to nobody, so only the owner may touch it. Guessing
 * would mean handing a stranger's expense to whoever asked.
 *
 * "missing" rather than "forbidden" when the row is not in this trip: authorisation is
 * per trip and the id arrives in a request body, so an id from somewhere else must look
 * exactly like an id that does not exist.
 */
export function authorRule(
  kind: "expense" | "payment",
  rowId: string,
  tripId: string,
  caller: { id?: string; isOwner: boolean }
): AuthorCheck {
  if (!isValidId(tripId) || !isValidId(rowId)) return "missing";

  const seat = caller.id ? memberForUser(tripId, caller.id) : null;

  if (kind === "expense") {
    const row = db
      .select({ createdBy: expenses.createdBy, paidBy: expenses.paidBy })
      .from(expenses)
      .where(and(eq(expenses.id, rowId), eq(expenses.tripId, tripId)))
      .get();
    if (!row) return "missing";
    if (caller.isOwner) return "ok";
    // Whoever typed it, and whoever it says paid.
    //
    // Those are not the same person, and the rule used to look only at the first: if I
    // entered "Andoni paid 40" and got the figure wrong, Andoni could not correct the
    // record of his own money — he had to ask me. The person the expense is *about* has
    // at least as much standing over it as the person who happened to hold the phone.
    if (row.createdBy && row.createdBy === caller.id) return "ok";
    return seat && row.paidBy === seat.id ? "ok" : "forbidden";
  }

  const row = db
    .select({ createdBy: payments.createdBy, from: payments.fromMember, to: payments.toMember })
    .from(payments)
    .where(and(eq(payments.id, rowId), eq(payments.tripId, tripId)))
    .get();
  if (!row) return "missing";
  if (caller.isOwner) return "ok";
  if (row.createdBy && row.createdBy === caller.id) return "ok";
  // A settle-up is a statement about two people, and either of them may take it back.
  return seat && (row.from === seat.id || row.to === seat.id) ? "ok" : "forbidden";
}

/** Which rows of a trip one account wrote, so the UI can offer editing only on those. */
export function authoredBy(
  tripId: string,
  userId: string
): { expenses: Set<string>; payments: Set<string> } {
  const mineIn = <T extends typeof expenses | typeof payments>(table: T) =>
    new Set(
      db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.tripId, tripId), eq(table.createdBy, userId)))
        .all()
        .map((r) => r.id as string)
    );
  return { expenses: mineIn(expenses), payments: mineIn(payments) };
}

/**
 * Who entered each expense, by the name they go by in this trip.
 *
 * Shown next to the expense because the rule about who may change it is otherwise
 * invisible: somebody looking at a line with no edit button is told neither whose it is
 * nor who to ask. Resolved to their seat's name rather than their account's, so it
 * matches every other name on the screen — a person is "Papá" in the family trip whoever
 * their account says they are.
 */
export function expenseAuthors(tripId: string): Record<string, string> {
  const rows = db
    .select({ id: expenses.id, seatName: members.name, accountName: users.name })
    .from(expenses)
    .leftJoin(users, eq(users.id, expenses.createdBy))
    .leftJoin(
      members,
      and(eq(members.tripId, expenses.tripId), eq(members.userId, expenses.createdBy))
    )
    .where(eq(expenses.tripId, tripId))
    .all();

  const byId: Record<string, string> = {};
  for (const row of rows) {
    const name = row.seatName ?? row.accountName;
    if (name) byId[row.id] = name;
  }
  return byId;
}

// ─── What happened, and who did it ───────────────────────────────────

/**
 * Records something worth telling the others about.
 *
 * Called from the routes rather than from the writes themselves: the store has no idea
 * who is asking, and threading a user id through every function so it could log would
 * put identity into places that are better off not knowing about it.
 *
 * Never throws into the caller's path. A trip whose expense was saved but whose feed
 * entry was not is a trip with a gap in its history; one that refuses the expense because
 * the history failed is worse.
 */
export function logActivity(
  tripId: string,
  /** Resolved to what they are called *in this trip*, which is what the feed shows. */
  user: { id: string; name: string } | null,
  action: string,
  subject?: string | null
): void {
  try {
    const seatName = user ? memberForUser(tripId, user.id)?.name : null;
    db.insert(activity)
      .values({
        id: generateId(),
        tripId,
        userId: user?.id ?? null,
        actorName: (seatName ?? user?.name ?? "?").slice(0, 50),
        action,
        subject: subject?.slice(0, 100) ?? null,
        createdAt: Date.now(),
      })
      .run();
  } catch (error) {
    console.error("Could not record activity:", error);
  }
}

export interface ActivityEntry {
  id: string;
  actorName: string;
  action: string;
  subject: string | null;
  createdAt: number;
}

/** The feed, newest first. Capped: nobody scrolls to the beginning of a trip. */
export function readActivity(tripId: string, limit = 100): ActivityEntry[] {
  if (!isValidId(tripId)) return [];
  return db
    .select({
      id: activity.id,
      actorName: activity.actorName,
      action: activity.action,
      subject: activity.subject,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .where(eq(activity.tripId, tripId))
    .orderBy(desc(activity.createdAt))
    .limit(Math.min(limit, 200))
    .all();
}

// ─── Comments ────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: number;
  /** Whether the reader may delete it: their own, or the owner's prerogative. */
  mine: boolean;
}

export function readComments(
  tripId: string,
  expenseId: string,
  reader: { id?: string; isOwner: boolean }
): Comment[] {
  if (!isValidId(tripId) || !isValidId(expenseId)) return [];
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.tripId, tripId), eq(comments.expenseId, expenseId)))
    .orderBy(asc(comments.createdAt))
    .all()
    .map((c) => ({
      id: c.id,
      authorName: c.authorName,
      body: c.body,
      createdAt: c.createdAt,
      mine: reader.isOwner || (Boolean(c.userId) && c.userId === reader.id),
    }));
}

export function addComment(input: {
  tripId: string;
  expenseId: string;
  userId: string;
  authorName: string;
  body: string;
}): Comment | null {
  const body = input.body.trim().slice(0, 500);
  if (!body) return null;
  // Scoped to the trip that was authorised, like every other id arriving in a body.
  if (!belongsToTrip(expenses, input.expenseId, input.tripId)) return null;

  const id = generateId();
  const createdAt = Date.now();
  db.insert(comments)
    .values({
      id,
      expenseId: input.expenseId,
      tripId: input.tripId,
      userId: input.userId,
      authorName: input.authorName.slice(0, 50),
      body,
      createdAt,
    })
    .run();

  return { id, authorName: input.authorName, body, createdAt, mine: true };
}

export function deleteComment(
  tripId: string,
  commentId: string,
  reader: { id?: string; isOwner: boolean }
): "ok" | "missing" | "forbidden" {
  if (!isValidId(tripId) || !isValidId(commentId)) return "missing";

  const row = db
    .select({ userId: comments.userId })
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.tripId, tripId)))
    .get();
  if (!row) return "missing";
  if (!reader.isOwner && !(row.userId && row.userId === reader.id)) return "forbidden";

  db.delete(comments).where(eq(comments.id, commentId)).run();
  return "ok";
}

/** How many comments each expense has, so the list can show it without loading them. */
export function commentCounts(tripId: string): Record<string, number> {
  const rows = db
    .select({ expenseId: comments.expenseId, count: sql<number>`count(*)` })
    .from(comments)
    .where(eq(comments.tripId, tripId))
    .groupBy(comments.expenseId)
    .all();
  return Object.fromEntries(rows.map((r) => [r.expenseId, Number(r.count)]));
}

export interface CreateTripInput {
  name: string;
  /** Trip, shared home, couple or other. A label, not a rule. */
  kind: TripKind;
  currency: string;
  /**
   * Anyone else, by bare name. May be empty.
   *
   * A trip used to demand two names up front, which is backwards now that people
   * arrive by invitation: at the moment of creating it you cannot know what the second
   * person will be called, and a trip of one that grows is the normal way round.
   */
  members: { name: string; emoji: string }[];
  /** Every trip belongs to somebody; there is no anonymous mode. */
  ownerId: string;
  /** The owner is always the first participant, and is linked to their account. */
  ownerName: string;
}

export async function createTrip(input: CreateTripInput): Promise<Trip> {
  const id = generateId();
  const now = Date.now();

  db.transaction((tx) => {
    tx.insert(trips)
      .values({
        id,
        name: input.name,
        kind: input.kind,
        currency: input.currency,
        createdAt: now,
        updatedAt: now,
        version: 1,
        ownerId: input.ownerId,
      })
      .run();

    // The owner goes in first and linked: whoever creates a trip is in it, and the app
    // knowing which participant they are is the whole point of linking at all.
    tx.insert(members)
      .values({
        id: generateId(),
        tripId: id,
        name: input.ownerName,
        emoji: EMOJIS[0],
        position: 0,
        userId: input.ownerId,
      })
      .run();

    input.members.forEach((m, i) => {
      tx.insert(members)
        .values({ id: generateId(), tripId: id, name: m.name, emoji: m.emoji, position: i + 1 })
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
  patch: { name?: string; kind?: TripKind; currency?: string; budget?: number | null }
): Promise<boolean> {
  if (!isValidId(id)) return false;
  const result = db
    .update(trips)
    .set({ ...patch, updatedAt: Date.now(), version: sql`${trips.version} + 1` })
    .where(eq(trips.id, id))
    .run();
  return result.changes > 0;
}

export interface AddExpenseInput {
  description: string;
  amount: number;
  currency: string;
  amountBase: number;
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
  /** The account entering it, which is who may edit it afterwards. */
  createdBy?: string;
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
        amountBase: input.amountBase,
        paidBy: input.paidBy,
        category: input.category,
        date,
        exchangeRate: input.exchangeRate ?? null,
        rateAvailable: input.rateAvailable ?? true,
        note: input.note ?? null,
        receipt: input.receipt ?? null,
        clientId: input.clientId ?? null,
        createdBy: input.createdBy ?? null,
      })
      .run();

    for (const memberId of input.splitAmong) {
      tx.insert(expenseSplits)
        .values({ expenseId, memberId, share: input.splitShares?.[memberId] ?? 1 })
        .run();
    }

    touchTrip(tx, tripId);
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
  // The id comes from the request body; the authorisation came from the URL.
  if (!belongsToTrip(expenses, expenseId, tripId)) return null;

  db.transaction((tx) => {
    const fields: Record<string, unknown> = {};
    for (const key of [
      "description",
      "amount",
      "currency",
      "amountBase",
      "paidBy",
      "category",
      "date",
      "exchangeRate",
      "rateAvailable",
    ] as const) {
      if (patch[key] !== undefined) fields[key] = patch[key];
    }
    if (Object.keys(fields).length > 0) {
      tx.update(expenses)
        .set(fields)
        .where(and(eq(expenses.id, expenseId), eq(expenses.tripId, tripId)))
        .run();
    }

    if (patch.splitAmong) {
      tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId)).run();
      for (const memberId of patch.splitAmong) {
        tx.insert(expenseSplits)
          .values({ expenseId, memberId, share: patch.splitShares?.[memberId] ?? 1 })
          .run();
      }
    }

    touchTrip(tx, tripId);
  });

  const trip = await getTrip(tripId);
  return trip?.expenses.find((e) => e.id === expenseId) ?? null;
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<boolean> {
  if (!isValidId(tripId) || !isValidId(expenseId)) return false;
  const result = db
    .delete(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.tripId, tripId)))
    .run();
  if (result.changes > 0) touchTrip(db, tripId);
  return result.changes > 0;
}

export interface AddPaymentInput {
  /** Idempotency key from the client. */
  clientId?: string;
  from: string;
  to: string;
  amount: number;
  /** What it was handed over in. Defaults to the trip's currency at the call site. */
  currency: string;
  /** The same amount in the trip's currency, converted by the caller. */
  amountBase: number;
  rateAvailable?: boolean;
  date?: number;
  note?: string;
  /** The account recording it, which is who may undo it afterwards. */
  createdBy?: string;
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
        currency: existing.currency,
        amountBase: existing.amountBase,
        rateAvailable: existing.rateAvailable,
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
        currency: input.currency,
        amountBase: input.amountBase,
        rateAvailable: input.rateAvailable ?? true,
        date,
        note: input.note ?? null,
        clientId: input.clientId ?? null,
        createdBy: input.createdBy ?? null,
      })
      .run();
    touchTrip(tx, tripId);
  });

  return {
    id,
    from: input.from,
    to: input.to,
    amount: input.amount,
    currency: input.currency,
    amountBase: input.amountBase,
    rateAvailable: input.rateAvailable ?? true,
    date,
    note: input.note,
  };
}

export async function deletePayment(tripId: string, paymentId: string): Promise<boolean> {
  if (!isValidId(tripId) || !isValidId(paymentId)) return false;
  const result = db
    .delete(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.tripId, tripId)))
    .run();
  if (result.changes > 0) touchTrip(db, tripId);
  return result.changes > 0;
}

/**
 * Takes somebody out of a trip. The owner's alone to do.
 *
 * Two different acts, chosen by what the seat is rather than by a flag on the request:
 *
 *   Somebody still in the trip loses their access and keeps their seat, with the column
 *   and every figure in it exactly where it was. "They have left the trip" is not a
 *   statement that their half of the taxi never happened, and the destructive reading of
 *   that is not one to take on a single tap.
 *
 *   Anything else — a free member, or an account that was already shown the door — is
 *   deleted, and the cascade takes with it the expenses they paid for, the payments they
 *   were part of and their share of everyone else's. So pressing it twice does both, as
 *   two decisions.
 *
 * The seat stays *linked* to the account it belongs to, which is the point: a departed
 * person's column is not a free name for a stranger to claim, and inviting them back
 * puts them in the column that was already theirs instead of starting a second one
 * beside it, holding none of their money.
 *
 * The owner's own seat is refused, and refused before anything is written: a trip whose
 * owner is not in it has nobody who can put them back, and a batch that fails halfway
 * would report an error over work it had already done.
 */
export type RemovalRefusal = { reason: "owner" | "balance"; names: string[] };

export async function removeMembers(
  tripId: string,
  memberIds: string[]
): Promise<{ removed: number; released: number; refused: RemovalRefusal | null }> {
  const empty = { removed: 0, released: 0, refused: null };
  if (!isValidId(tripId) || memberIds.length === 0) return empty;

  const owner = db
    .select({ ownerId: trips.ownerId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .get();
  if (!owner) return empty;

  const wanted = memberIds.filter(isValidId);
  const rows = wanted
    .map((memberId) =>
      db
        .select({ id: members.id, userId: members.userId, name: members.name })
        .from(members)
        // Scoped to the trip that was authorised, not to the id alone.
        .where(and(eq(members.id, memberId), eq(members.tripId, tripId)))
        .get()
    )
    .filter((row): row is { id: string; userId: string | null; name: string } => Boolean(row));

  const ownerRow = rows.find((row) => row.userId && row.userId === owner.ownerId);
  if (ownerRow) return { ...empty, refused: { reason: "owner", names: [ownerRow.name] } };

  const stillIn = (userId: string | null) =>
    Boolean(
      userId &&
        db
          .select({ userId: tripAccess.userId })
          .from(tripAccess)
          .where(and(eq(tripAccess.tripId, tripId), eq(tripAccess.userId, userId)))
          .get()
    );

  /**
   * Nobody is deleted while the money still says something.
   *
   * Splitwise refuses this outright and it is the right call: deleting a participant
   * takes their expenses with them, so everyone else's share of a bill they were part of
   * silently changes. If they are owed twelve euros, that is a fact about other people's
   * pockets, and it does not stop being true because somebody tapped an X. Settle first,
   * then there is nothing to lose.
   *
   * Only the deletions are checked. Stepping out of a trip changes no figure at all, and
   * making somebody settle up before they can be shown the door would be a rule with
   * nothing behind it.
   */
  const doomed = rows.filter((row) => !stillIn(row.userId));
  if (doomed.length > 0) {
    const trip = await getTrip(tripId);
    const balances = trip ? calculateBalances(trip) : [];
    const owing = doomed.filter((row) => {
      const balance = balances.find((b) => b.memberId === row.id)?.balance ?? 0;
      return Math.round(balance * 100) !== 0;
    });
    if (owing.length > 0) {
      return { ...empty, refused: { reason: "balance", names: owing.map((row) => row.name) } };
    }
  }

  let removed = 0;
  let released = 0;
  db.transaction((tx) => {
    for (const row of rows) {
      const scope = and(eq(members.id, row.id), eq(members.tripId, tripId));

      if (stillIn(row.userId)) {
        tx.delete(tripAccess)
          .where(and(eq(tripAccess.tripId, tripId), eq(tripAccess.userId, row.userId!)))
          .run();
        released++;
        continue;
      }

      removed += tx.delete(members).where(scope).run().changes;
    }
    if (removed > 0 || released > 0) touchTrip(tx, tripId);
  });
  return { removed, released, refused: null };
}

/**
 * Hands a trip to somebody else in it.
 *
 * Without this the owner is a single point of failure: only they can invite, rename or
 * take anybody out, and there was no way to move that — so an owner who left the group,
 * lost their phone or deleted their account took the trip's administration with them.
 *
 * The old owner stays in the trip as an ordinary member. They keep their seat and every
 * figure in it; what they lose is the trip's settings, which is the whole point.
 */
export async function transferOwnership(
  tripId: string,
  memberId: string
): Promise<"ok" | "missing" | "not-an-account"> {
  if (!isValidId(tripId) || !isValidId(memberId)) return "missing";

  const trip = db.select({ ownerId: trips.ownerId }).from(trips).where(eq(trips.id, tripId)).get();
  if (!trip) return "missing";

  const target = db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tripId, tripId)))
    .get();
  if (!target) return "missing";
  // A name with nobody behind it cannot be handed a trip, and neither can somebody who
  // is no longer in it.
  if (!target.userId || !stillInTrip(tripId, target.userId)) return "not-an-account";

  const previous = trip.ownerId;
  db.transaction((tx) => {
    tx.update(trips).set({ ownerId: target.userId }).where(eq(trips.id, tripId)).run();
    // The outgoing owner held no grant row, because owning the trip was their way in.
    if (previous) {
      tx.insert(tripAccess)
        .values({ tripId, userId: previous, createdAt: Date.now() })
        .onConflictDoNothing({ target: [tripAccess.tripId, tripAccess.userId] })
        .run();
    }
    touchTrip(tx, tripId);
  });
  return "ok";
}

/** Whether an account can still open a trip, without going through `accessLevel`. */
function stillInTrip(tripId: string, userId: string): boolean {
  const trip = db.select({ ownerId: trips.ownerId }).from(trips).where(eq(trips.id, tripId)).get();
  if (trip?.ownerId === userId) return true;
  return Boolean(
    db
      .select({ userId: tripAccess.userId })
      .from(tripAccess)
      .where(and(eq(tripAccess.tripId, tripId), eq(tripAccess.userId, userId)))
      .get()
  );
}

export async function addMember(
  tripId: string,
  name: string,
  emoji: string,
  /** Set when this participant is a registered account rather than a bare name. */
  userId?: string
): Promise<Member | null> {
  if (!isValidId(tripId)) return null;
  const id = generateId();
  const count = db.select().from(members).where(eq(members.tripId, tripId)).all().length;
  db.insert(members)
    .values({ id, tripId, name, emoji, position: count, userId: userId ?? null })
    .run();
  touchTrip(db, tripId);
  return { id, name, emoji, userId };
}

/**
 * Gives an account its own place in a trip.
 *
 * What happens whenever somebody joins and there is nothing of theirs to claim: an
 * invitation accepted, an address added by the owner. Their account name is the starting
 * point and the alias is theirs to change afterwards — the seat is the thing that has to
 * exist, because a person in a trip who is in nobody's split is the shape this whole
 * model was built to get rid of.
 *
 * Idempotent: joining twice, or from two devices, still means one column.
 */
export async function seatUser(
  tripId: string,
  user: { id: string; name: string }
): Promise<Member | null> {
  if (!isValidId(tripId)) return null;

  const existing = memberForUser(tripId, user.id);
  if (existing) return existing;

  const count = db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.tripId, tripId))
    .all().length;

  const base = user.name.trim().slice(0, 50) || "?";
  let name = base;
  for (let n = 2; memberNameTaken(tripId, name); n++) name = `${base.slice(0, 46)} ${n}`;

  return addMember(tripId, name, EMOJIS[count % EMOJIS.length], user.id);
}

// ─── Members and accounts ────────────────────────────────────────────

/**
 * Which participant a given account is in a trip, if any.
 *
 * Having access to a trip and being one of the people it splits between are two
 * different things, and until now the app only modelled the first: somebody who
 * accepted an invitation could read the trip and add expenses, yet was in nobody's
 * split unless the owner had separately typed their name — and then the name and the
 * account had nothing to do with each other.
 */
export function memberForUser(tripId: string, userId: string): Member | null {
  const row = db
    .select()
    .from(members)
    .where(and(eq(members.tripId, tripId), eq(members.userId, userId)))
    .get();
  return row ? { id: row.id, name: row.name, emoji: row.emoji, userId: row.userId } : null;
}

/**
 * Seats that are spoken for: somebody was invited by email and their link is still live.
 *
 * Unclaimed is not the same as free. A seat made by inviting one particular address is
 * reserved for the person who was sent that link, and offering it to whoever opens a
 * general invitation first is how the wrong person ends up in it — after which the one
 * it was made for arrives, finds it taken, and has to join as a stranger.
 */
function reservedMembers(tripId: string): Set<string> {
  return new Set(
    db
      .select({ memberId: invites.memberId })
      .from(invites)
      .where(and(eq(invites.tripId, tripId), gt(invites.expiresAt, Date.now())))
      .all()
      .map((r) => r.memberId)
      .filter((id): id is string => Boolean(id))
  );
}

/** Participants nobody has claimed or reserved: what "which one are you?" may offer. */
export function unlinkedMembers(tripId: string): Member[] {
  const reserved = reservedMembers(tripId);
  return db
    .select()
    .from(members)
    .where(and(eq(members.tripId, tripId), isNull(members.userId)))
    .orderBy(asc(members.position))
    .all()
    .filter((m) => !reserved.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, emoji: m.emoji }));
}

/**
 * Ties an existing participant to an account.
 *
 * Claiming rather than being assigned: the trip was written by somebody else, who typed
 * a list of names, and only the person reading it knows which of them is them. It also
 * covers every trip made before any of this existed, whose members are all bare text —
 * without a claim they would stay unclaimable for good.
 *
 * Refuses if the member is already somebody else's, or if this account is already a
 * participant, so one person cannot end up as two columns of the same split.
 */
export function claimMember(
  tripId: string,
  memberId: string,
  userId: string,
  /** Only the invitation that reserved a seat may seat somebody in it. */
  options: { allowReserved?: boolean } = {}
): Member | null {
  if (!isValidId(tripId) || !isValidId(memberId)) return null;
  if (memberForUser(tripId, userId)) return null;
  if (!options.allowReserved && reservedMembers(tripId).has(memberId)) return null;

  const result = db
    .update(members)
    .set({ userId })
    .where(and(eq(members.id, memberId), eq(members.tripId, tripId), isNull(members.userId)))
    .run();
  if (result.changes === 0) return null;

  touchTrip(db, tripId);
  return memberForUser(tripId, userId);
}

/**
 * Renames a participant.
 *
 * This is the alias: the same account is "Andoni" among friends and "Papá" in the
 * family trip, and neither is a lie about who they are — the link to the account is
 * what carries identity, the name is only what to call them here.
 */
export function renameMember(tripId: string, memberId: string, name: string): boolean {
  if (!isValidId(tripId) || !isValidId(memberId)) return false;
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) return false;

  const result = db
    .update(members)
    .set({ name: trimmed })
    .where(and(eq(members.id, memberId), eq(members.tripId, tripId)))
    .run();
  if (result.changes === 0) return false;

  touchTrip(db, tripId);
  return true;
}

/** Whether a name is already taken in this trip, which the UI relies on to stay readable. */
export function memberNameTaken(tripId: string, name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(eq(members.tripId, tripId))
    .all()
    .some((m) => m.id !== exceptId && m.name.trim().toLowerCase() === wanted);
}

// ─── Calculations (unchanged behaviour) ──────────────────────────────




// ─── Exchange rates ──────────────────────────────────────────────────
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
    amountBase: row.amountBase,
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
 * Creates an invitation link.
 *
 * The link is what gets somebody in: the trip URL on its own is not a credential, and
 * registration is closed by default, so without this a person who was sent a trip had
 * no way to reach it at all.
 */
export async function createInvite(
  tripId: string,
  /**
   * The participant this link is for, when it was made by inviting somebody by email.
   *
   * Without it an invitation only ever granted access, and the person who accepted was
   * left outside the split until somebody typed their name in separately. Naming the
   * member here means accepting the invitation puts them in the arithmetic, under the
   * account they signed in with.
   */
  memberId?: string,
  /** The address it was made for, so typing it twice does not make a second seat. */
  email?: string
): Promise<{ token: string; expiresAt: number } | null> {
  if (!isValidId(tripId)) return null;

  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const expiresAt = now + INVITE_DAYS * 24 * 60 * 60 * 1000;

  db.insert(invites)
    .values({
      token,
      tripId,
      createdAt: now,
      expiresAt,
      memberId: memberId ?? null,
      email: email ?? null,
    })
    .run();
  return { token, expiresAt };
}

/**
 * A live invitation already waiting for an address, with the seat it holds.
 *
 * Answers "have I already invited this person?" exactly, rather than by looking at the
 * name on a seat — which is the part before the @, and so cannot tell carla@gmail from
 * carla@yahoo. Null once the seat has been taken: at that point they are in the trip and
 * there is nothing left to send.
 */
export function pendingInviteFor(
  tripId: string,
  email: string
): { token: string; expiresAt: number; memberId: string } | null {
  const row = db
    .select({ token: invites.token, expiresAt: invites.expiresAt, memberId: invites.memberId })
    .from(invites)
    .innerJoin(members, eq(members.id, invites.memberId))
    .where(
      and(
        eq(invites.tripId, tripId),
        eq(invites.email, email),
        gt(invites.expiresAt, Date.now()),
        isNull(members.userId)
      )
    )
    .get();

  return row?.memberId
    ? { token: row.token, expiresAt: row.expiresAt, memberId: row.memberId }
    : null;
}

export interface InviteDetails {
  tripId: string;
  tripName: string;
  /** The participant the link is for, when it names one. */
  memberId?: string | null;
  memberName?: string | null;
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

  // A member that has since been claimed or removed makes the link a plain invitation
  // again rather than an error: the access it grants is still worth honouring.
  const member = invite.memberId
    ? db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(and(eq(members.id, invite.memberId), isNull(members.userId)))
        .get()
    : null;

  return {
    tripId: invite.tripId,
    tripName: trip.name,
    memberId: member?.id ?? null,
    memberName: member?.name ?? null,
  };
}

/**
 * Redeems an invitation for a user.
 *
 * The token is deliberately not consumed: a trip link gets forwarded around a group,
 * and a single-use invite would work for whoever tapped first and leave everyone else
 * with an error they cannot explain. The expiry is what bounds it.
 */
export async function redeemInvite(
  token: string,
  user: { id: string; name: string; email: string }
): Promise<{ tripId: string; memberId: string | null } | null> {
  const invite = readInvite(token);
  if (!invite) return null;

  // The owner opening their own link is already in; anyone else is let in now.
  if (accessLevel(invite.tripId, user.id) === "none") {
    const granted = await grantAccess(invite.tripId, user.id);
    if (!granted) return null;
  }

  // Accepting an invitation puts you in the split. It used to grant access and nothing
  // else, which is how somebody could be in a trip, adding expenses, and appear in
  // nobody's balance — including their own.
  //
  // Three cases, and only one of them is a question:
  let seat = memberForUser(invite.tripId, user.id);

  // A link made for one person seats them where they were expected.
  if (!seat && invite.memberId) {
    seat = claimMember(invite.tripId, invite.memberId, user.id, { allowReserved: true });

    // The seat was labelled from the address, because at the time that was all anybody
    // knew about them — "carla-1785940262", which is nobody's name. Now that there is an
    // account behind it, use the name on it. Narrow on purpose: only a label that is
    // still exactly the local part of *their own* address is replaced, so a name the
    // owner typed deliberately is never overwritten.
    const fromAddress = user.email.split("@")[0];
    if (seat && seat.name === fromAddress && !memberNameTaken(invite.tripId, user.name)) {
      renameMember(invite.tripId, seat.id, user.name);
      seat = memberForUser(invite.tripId, user.id);
    }
  }

  // Nothing free that could be theirs, so there is nothing to ask about: they join as
  // themselves, under their own name, and can rename it once inside.
  if (!seat && unlinkedMembers(invite.tripId).length === 0) {
    seat = await seatUser(invite.tripId, user);
  }

  // Otherwise the trip still holds names somebody typed before they arrived, one of
  // which may be them — and that is a guess about money, so the trip asks.
  return { tripId: invite.tripId, memberId: seat?.id ?? null };
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
