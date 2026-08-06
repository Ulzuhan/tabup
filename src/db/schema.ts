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
 * Every trip belongs to an account.
 *
 * There was an anonymous mode once, where holding the link was the whole credential.
 * It went because it needed a second set of rules nobody could keep straight — claiming,
 * ownerless deletion, trips remembered only by one browser — and questions it could not
 * answer, like what happens when two people claim the same link.
 *
 * Note this is about *access*, not about who is in the split: the people a trip divides
 * its bills between are `members`, and most of them will never have an account here.
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
  /** "admin" or "user". The first account to exist becomes the admin. */
  role: text("role").notNull().default("user"),
  /**
   * When the account was let in. Null means it is a request waiting on the admin.
   *
   * Stored on the user rather than in a separate requests table: a pending account is
   * already a real account with a hashed password and a claimed email address, and
   * keeping a second half-user shape around would mean two places to get password
   * handling right.
   */
  approvedAt: integer("approved_at"),
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
    /**
     * Who the trip belongs to. Null only ever survives from before accounts existed,
     * and `adoptOrphanTrips` clears it on the next start.
     */
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * What kind of thing this is: a trip, a shared home, a couple, or anything else.
     *
     * It changes no rule and no arithmetic — it is a label and an icon. But calling
     * everything a "trip" made half the real use of this app read as a mistake: a flat
     * share is not a holiday that never ends, and the copy said otherwise on every
     * screen. Splitwise reached the same conclusion and calls them group types.
     */
    kind: text("kind").notNull().default("trip"),
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

/**
 * People other than the owner who are in a trip.
 *
 * There were roles here once — editor and viewer — and they were a second, parallel
 * answer to "who is in this trip", sitting alongside `members` and disagreeing with it.
 * Being let in and being one of the people the bill is split between were separate
 * facts, so inviting somebody as an editor gave them the run of the trip while leaving
 * them out of the arithmetic entirely, and the owner had to remember to add them again
 * by hand in the other list.
 *
 * Now there is one answer: a row here means a seat in `members`, and a seat linked to an
 * account means a row here. What anyone may *do* follows from the trip — the owner keeps
 * the trip itself, everyone adds expenses, and each may change the ones they entered —
 * so nothing needs to be stored per person at all.
 */
export const tripAccess = sqliteTable(
  "trip_access",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    /**
     * The account this participant is, when there is one.
     *
     * Null is not a gap to be filled: a trip splits a bill between the people at the
     * table, and most of them will never have an account here. What the link buys is
     * knowing *which* participant a given reader is — the difference between "Andoni
     * owes 23" and "you owe 23", and the only way settling up can mean anything
     * between accounts. Free members stay first-class; they are simply anonymous.
     *
     * Unique per trip, so one account can never end up as two columns of the same
     * split.
     */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("members_trip_idx").on(t.tripId),
    uniqueIndex("members_trip_user_idx").on(t.tripId, t.userId),
  ]
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
    /**
     * The same amount in the trip's own currency, which is what every total, balance and
     * settlement is computed and displayed in.
     *
     * This used to be euros, and the trip's currency was only ever a symbol printed in
     * front of the number — so a trip kept in pesos showed its totals converted to euros
     * with a ₱ in front, off by a factor of seventy. Normalising to the trip's currency
     * instead means the common unit and the unit on screen are the same thing, and a
     * trip in the currency people are actually spending needs no conversion at all.
     */
    amountBase: real("amount_base").notNull(),
    paidBy: text("paid_by")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("other"),
    date: integer("date").notNull(),
    exchangeRate: real("exchange_rate"),
    /** Free text, for what a description has no room for. */
    note: text("note"),
    /** Filename of the receipt photo under data/receipts/<tripId>/, if there is one. */
    receipt: text("receipt"),
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
    /**
     * The account that entered it.
     *
     * Everyone in a trip can add expenses, and each answers for what they added: this is
     * what lets the app tell "your mistake" from "somebody else's figure", so an edit
     * button is only offered to the person who typed it, or to the owner.
     *
     * Null on everything written before this column existed, and on anything left by a
     * deleted account. It is not a gap to fill by guessing — an unattributed row is one
     * only the owner may touch.
     */
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
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
    /** Amount as entered, in `currency`. */
    amount: real("amount").notNull(),
    /**
     * The currency it was actually handed over in.
     *
     * A settle-up used to be assumed to be in the trip's currency, which is wrong the
     * moment anybody pays a peso debt with a bank transfer in euros — the commonest way
     * a trip ends. Splid supports exactly this and calls it out as a feature.
     */
    currency: text("currency").notNull().default("EUR"),
    /** The same amount in the trip's currency; what the balances are computed from. */
    amountBase: real("amount_base").notNull().default(0),
    /** False when the rate used was approximate. Same meaning as on an expense. */
    rateAvailable: integer("rate_available", { mode: "boolean" }).notNull().default(true),
    date: integer("date").notNull(),
    note: text("note"),
    /** Same idempotency guarantee as expenses. */
    clientId: text("client_id"),
    /** Who recorded it; same rule as an expense. See `expenses.createdBy`. */
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("payments_trip_idx").on(t.tripId),
    uniqueIndex("payments_client_idx").on(t.tripId, t.clientId),
  ]
);

/**
 * Invitation links.
 *
 * Sharing an owned trip used to require the other person to already have an account
 * here — and registration is closed by default, so in practice there was no way in at
 * all: scanning the QR of an owned trip just returned 404. A token in a link fixes
 * both halves: it identifies the trip and it is proof enough to be allowed to register.
 */
export const invites = sqliteTable(
  "invites",
  {
    token: text("token").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    /**
     * The participant this link is for, when it was made by inviting somebody by email.
     *
     * An invitation used to grant access and nothing else, so the person who accepted
     * could read the trip and add expenses while being in nobody's split until the
     * owner separately typed a name that had no connection to their account. Naming the
     * member here closes that gap: accepting seats them.
     */
    memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
    /**
     * The address it was made for, lowercased, when it was made for one.
     *
     * Without it, an owner who typed the same address twice — because they were not sure
     * the first one had worked, which is the normal reason anyone does — got a second
     * seat beside the first, and one of the two was then guaranteed to stay empty
     * forever. The name on the seat could not be used to tell: it is the part before the
     * @, so carla@gmail and carla@yahoo produce the same one.
     */
    email: text("email"),
  },
  (t) => [index("invites_trip_idx").on(t.tripId)]
);

/**
 * What happened in a trip, and who did it.
 *
 * The model says everyone answers for what they entered, and the owner can change
 * anything. Neither half means much unless it can be seen: a rule about responsibility
 * that leaves no trace is a promise, not a record. This is the trace.
 *
 * The actor's name is copied in as text rather than read through the account. A feed is
 * read months later, by which time the person may have been taken out of the trip,
 * renamed themselves, or deleted their account — and "somebody deleted your expense" is
 * exactly the line that must still be legible then.
 */
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    /** Null once the account is gone; `actorName` is what the feed actually shows. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** What they were called in this trip at the moment they did it. */
    actorName: text("actor_name").notNull(),
    /** A key the UI translates, e.g. "expense.added". Never a sentence. */
    action: text("action").notNull(),
    /** What it was done to: an expense's description, a person's name, a trip's name. */
    subject: text("subject"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("activity_trip_idx").on(t.tripId, t.createdAt)]
);

/**
 * What people say about an expense, as opposed to what they do to it.
 *
 * The point of these is that they are the alternative to editing. Somebody who thinks a
 * figure is wrong has two ways to act on it: change it, which rewrites what another
 * person recorded about their own money, or say so. Only one of those needs permission,
 * and the app that offers only the first is the app where people quietly overwrite each
 * other.
 */
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    /**
     * Denormalised from the expense so a comment can be authorised against the trip in
     * the URL without a join — the same pairing every other id in this app goes through.
     */
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Copied in for the same reason as `activity.actorName`. */
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("comments_expense_idx").on(t.expenseId)]
);

/**
 * A way back into an account, handed out one at a time by the admin.
 *
 * There is no email here, so there is no self-service "forgot my password" — somebody
 * who cannot get in asks, and the admin generates one of these and sends it over
 * whatever they already talk on. That is what makes the shape of it matter: the link
 * travels through a chat and stays there, so it is single-use and short-lived, and the
 * moment it is spent whatever is left in the conversation is worthless.
 *
 * It replaces the admin typing a password and dictating it — which stays valid forever,
 * is readable by anyone who scrolls back, and is a password the person did not choose.
 *
 * Only the hash is stored, like sessions: a leaked copy of this file must not be a
 * bag of working keys.
 */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    /** Set the moment it is spent. A used link is kept until it expires so that
        opening it twice says "already used" rather than "never existed". */
    usedAt: integer("used_at"),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)]
);

/**
 * Where a browser wants to be told things.
 *
 * One row per browser, not per person: somebody signed in on a phone and a laptop has
 * two, and both should ring. The endpoint is the browser vendor's push service — no
 * account of ours and no account of theirs, just a URL that vendor handed out — so the
 * only thing this app needs to send a notification is its own VAPID key pair.
 *
 * Dead subscriptions are not a problem to be tidied up on a schedule: the push service
 * answers 404 or 410 for a browser that has gone, and that answer is the signal to
 * delete the row. See `lib/push.ts`.
 */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    /** The endpoint is the identity; a browser re-subscribing returns the same one. */
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The two halves of the browser's key, used to encrypt the payload to it. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("push_user_idx").on(t.userId)]
);

/**
 * Small pieces of instance state that are not anybody's data.
 *
 * Currently one thing: the VAPID key pair, generated on first use. It lives in the
 * database rather than in the environment so the app needs no setup step to be able to
 * send a notification — losing it would only mean every browser has to subscribe again,
 * which is why it is not worth making somebody manage.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Recurring expenses: subscriptions, insurance, rent.
 *
 * A rule, not a ledger. Storing the norm plus when it started and stopped means any
 * month — past or future — can be computed, with nothing to generate and nothing that
 * breaks because the app went unopened for a while.
 *
 * Tied to a user rather than a trip: these are one person's fixed costs, they have no
 * one to split with, and they outlive any trip.
 */
export const recurring = sqliteTable(
  "recurring",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** As charged, in `currency`. */
    amount: real("amount").notNull(),
    currency: text("currency").notNull(),
    /** Converted once, so totals do not shift with every rate refresh. */
    amountBase: real("amount_base").notNull(),
    /** weekly | monthly | quarterly | yearly */
    period: text("period").notNull().default("monthly"),
    /** Day of the month it is charged; clamped to the length of short months. */
    chargeDay: integer("charge_day").notNull().default(1),
    /** Which month, for yearly charges. 1-12. */
    chargeMonth: integer("charge_month"),
    category: text("category").notNull().default("other"),
    startedAt: integer("started_at").notNull(),
    /** Null while it is still being paid. */
    endedAt: integer("ended_at"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("recurring_user_idx").on(t.userId)]
);

/**
 * Server failures, kept so somebody can see them.
 *
 * Until now a failure went to `console.error` and then to the systemd journal, which
 * means the only way to learn that the OCR or the exchange rates had stopped working was
 * to run into it yourself. Writing them down puts them in the admin's hands instead.
 *
 * Identical failures collapse onto one row with a count rather than filling the page:
 * a rate provider that is down produces the same error every few seconds, and a hundred
 * copies of it hide everything else.
 */
export const errorLog = sqliteTable(
  "error_log",
  {
    id: text("id").primaryKey(),
    /** Where it happened — the route or the operation, not a stack frame. */
    context: text("context").notNull(),
    message: text("message").notNull(),
    /** Trimmed; enough to find the line, not the whole novel. */
    stack: text("stack"),
    firstSeen: integer("first_seen").notNull(),
    lastSeen: integer("last_seen").notNull(),
    count: integer("count").notNull().default(1),
    /** Cleared by the admin once they have looked at it. */
    acknowledgedAt: integer("acknowledged_at"),
  },
  (t) => [
    index("error_log_last_idx").on(t.lastSeen),
    // What "the same failure" means, so repeats collapse instead of piling up.
    uniqueIndex("error_log_same_idx").on(t.context, t.message),
  ]
);

export type ErrorLogRow = typeof errorLog.$inferSelect;
export type RecurringRow = typeof recurring.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type TripRow = typeof trips.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
