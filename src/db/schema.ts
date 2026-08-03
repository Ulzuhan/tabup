import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/**
 * Relational schema replacing the previous one-JSON-file-per-trip storage.
 *
 * The old layout could not survive concurrent writes: every request read the whole
 * trip, mutated it in memory and wrote it back through a shared `.tmp` file. With
 * several people adding expenses at the same time — which is precisely the point of
 * the app — writes raced, some requests failed with ENOENT on rename and others
 * answered 200 while their expense silently vanished. Measured: 5 simultaneous
 * expenses, 1 survivor.
 *
 * With SQLite each write is its own transaction, so nothing is lost and nothing is
 * half-written.
 */

/**
 * Accounts are optional by design.
 *
 * A trip with no `ownerId` is an anonymous trip: whoever holds the link can read and
 * write it, which is how the app has always worked and what makes it usable in ten
 * seconds at a restaurant table. Registering turns that into a trip with an owner,
 * after which only the owner and the people in `tripAccess` can touch it.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  /** Stored lowercased; the unique index is what actually prevents duplicates. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  /** scrypt, see lib/auth.ts. Never null — there is no passwordless path yet. */
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  /** "free" or "pro". Quotas are enforced in the store, not here. */
  plan: text("plan").notNull().default("free"),
});

/**
 * Sessions hold a SHA-256 of the cookie token, not the token itself, so a leaked
 * database copy cannot be replayed as a login.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

export const trips = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("EUR"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    /** Bumped on every write; lets clients detect they are looking at stale data. */
    version: integer("version").notNull().default(1),
    /** Null means anonymous: access is granted by knowing the link. */
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * Optional spending target for the whole trip, in the trip's currency.
     *
     * Null means nobody set one, which is different from zero — a budget of zero would
     * report every trip as over budget from the first coffee.
     */
    budget: real("budget"),
  },
  (t) => [index("trips_owner_idx").on(t.ownerId)]
);

/** People other than the owner who can open an owned trip. */
export const tripAccess = sqliteTable(
  "trip_access",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "editor" can add expenses, "viewer" can only read. */
    role: text("role").notNull().default("editor"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.userId] }),
    index("trip_access_user_idx").on(t.userId),
  ]
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji").notNull().default("😊"),
    /** Preserves the order they were added in, which the UI relies on. */
    position: integer("position").notNull().default(0),
    /** Set when this participant is also a registered account. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("members_trip_idx").on(t.tripId)]
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    /** Amount as entered, in `currency`. */
    amount: real("amount").notNull(),
    currency: text("currency").notNull(),
    /** Converted to the common unit used for every balance computation. */
    amountEur: real("amount_eur").notNull(),
    paidBy: text("paid_by")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("other"),
    date: integer("date").notNull(),
    exchangeRate: real("exchange_rate"),
    /** Free text, for what a description has no room for. */
    note: text("note"),
    /**
     * Idempotency key chosen by the client, unique per trip.
     *
     * Without it, an expense sent from a queued offline write could be saved by the
     * server and have its response lost on the way back — the retry would then create a
     * second, identical expense. In an app about money, silently duplicating a charge is
     * the worst thing that can happen, so retries carry this and the server recognises
     * one it has already applied.
     */
    clientId: text("client_id"),
    /** False when no live or cached rate was available at the time. */
    rateAvailable: integer("rate_available", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    index("expenses_trip_idx").on(t.tripId),
    index("expenses_date_idx").on(t.date),
    uniqueIndex("expenses_client_idx").on(t.tripId, t.clientId),
  ]
);

/**
 * Who an expense is split among, and with what weight.
 *
 * A row per participant replaces the previous `splitAmong` array plus optional
 * `splitShares` map. Equal splits simply carry the same weight on every row.
 */
export const expenseSplits = sqliteTable(
  "expense_splits",
  {
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    share: real("share").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.memberId] }),
    index("splits_expense_idx").on(t.expenseId),
  ]
);

/** Settle-up transfers between members, in the trip's currency. */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    fromMember: text("from_member")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    toMember: text("to_member")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    amount: real("amount").notNull(),
    date: integer("date").notNull(),
    note: text("note"),
    /** Same idempotency guarantee as expenses. */
    clientId: text("client_id"),
  },
  (t) => [
    index("payments_trip_idx").on(t.tripId),
    uniqueIndex("payments_client_idx").on(t.tripId, t.clientId),
  ]
);

export type UserRow = typeof users.$inferSelect;
export type TripRow = typeof trips.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
