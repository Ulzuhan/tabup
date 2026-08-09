import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";
import { randomBytes } from "crypto";
import * as schema from "./schema";
import { EMOJIS } from "../lib/types";

/**
 * Database connection.
 *
 * Kept on globalThis because Next reloads modules in development: without this each
 * reload would open another handle to the same file and they would fight over locks.
 */
const DB_PATH = process.env.TABUP_DB?.trim() || join(process.cwd(), "data", "tabup.db");

declare global {
  var __tabup_db__: ReturnType<typeof create> | undefined;
}

function create() {
  mkdirSync(join(DB_PATH, ".."), { recursive: true });
  const sqlite = new Database(DB_PATH);

  // WAL lets readers work while a write is in progress, which is what makes several
  // people adding expenses at once feel instant instead of serialised.
  sqlite.pragma("journal_mode = WAL");
  // Wait instead of failing immediately when another write holds the lock.
  sqlite.pragma("busy_timeout = 5000");
  // Cascading deletes are declared in the schema; SQLite ignores them unless this is on.
  sqlite.pragma("foreign_keys = ON");

  // Not while building.
  //
  // `db` is created when this module is imported, and a production build imports every
  // route to work out what it is — so `next build` opened the live database and ran the
  // migrations against it, unasked and unwatched. It got away with it here, but a build
  // is the wrong moment to alter the file people's money is in: nobody is looking, the
  // running server still holds the old shape in memory, and there is no backup taken.
  // Migrations belong to a server that is starting up.
  if (process.env.NEXT_PHASE !== "phase-production-build") migrate(sqlite);

  return drizzle(sqlite, { schema });
}

/**
 * Schema creation, run on every start.
 *
 * Plain CREATE TABLE IF NOT EXISTS rather than a migration tool: the schema is small
 * and this keeps the container able to start against an empty volume with no extra
 * step. Once there are real users and schema changes, this should become versioned
 * migrations.
 */
function migrate(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '😊',
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS members_trip_idx ON members(trip_id);

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      amount_base REAL NOT NULL,
      paid_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'other',
      date INTEGER NOT NULL,
      exchange_rate REAL,
      rate_available INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS expenses_trip_idx ON expenses(trip_id);
    CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date);

    CREATE TABLE IF NOT EXISTS expense_splits (
      expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      share REAL NOT NULL DEFAULT 1,
      PRIMARY KEY (expense_id, member_id)
    );
    CREATE INDEX IF NOT EXISTS splits_expense_idx ON expense_splits(expense_id);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      from_member TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      to_member TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      date INTEGER NOT NULL,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS payments_trip_idx ON payments(trip_id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS trip_access (
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (trip_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS trip_access_user_idx ON trip_access(user_id);

    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invites_trip_idx ON invites(trip_id);

    CREATE TABLE IF NOT EXISTS recurring (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      amount_base REAL NOT NULL,
      period TEXT NOT NULL DEFAULT 'monthly',
      charge_day INTEGER NOT NULL DEFAULT 1,
      charge_month INTEGER,
      category TEXT NOT NULL DEFAULT 'other',
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recurring_user_idx ON recurring(user_id);

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_trip_idx ON activity(trip_id, created_at);

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_expense_idx ON comments(expense_id);

    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS push_user_idx ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      context TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      acknowledged_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS error_log_last_idx ON error_log(last_seen);
    CREATE UNIQUE INDEX IF NOT EXISTS error_log_same_idx ON error_log(context, message);
  `);

  // Columns added after the first release. CREATE TABLE IF NOT EXISTS above is a no-op
  // on databases that already have the table, so new columns need adding separately.
  addColumn(sqlite, "trips", "owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addColumn(sqlite, "users", "role", "TEXT NOT NULL DEFAULT 'user'");
  addColumn(sqlite, "users", "approved_at", "INTEGER");
  addColumn(sqlite, "expenses", "client_id", "TEXT");
  addColumn(sqlite, "expenses", "note", "TEXT");
  addColumn(sqlite, "expenses", "receipt", "TEXT");
  addColumn(sqlite, "trips", "budget", "REAL");
  addColumn(sqlite, "members", "former_account", "INTEGER NOT NULL DEFAULT 0");
  addColumn(sqlite, "trips", "kind", "TEXT NOT NULL DEFAULT 'trip'");
  addColumn(sqlite, "payments", "client_id", "TEXT");
  addColumn(sqlite, "members", "user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addColumn(sqlite, "invites", "member_id", "TEXT REFERENCES members(id) ON DELETE SET NULL");
  addColumn(sqlite, "invites", "email", "TEXT");
  addColumn(sqlite, "expenses", "created_by", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addColumn(sqlite, "payments", "created_by", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addColumn(sqlite, "payments", "currency", "TEXT");
  addColumn(sqlite, "payments", "amount_base", "REAL");
  addColumn(sqlite, "payments", "rate_available", "INTEGER NOT NULL DEFAULT 1");

  // Every payment written before a settle-up could name its own currency was, by
  // definition, in the trip's. Cheap, idempotent and self-limiting: it only ever touches
  // rows that have not been given one.
  sqlite.exec(
    `UPDATE payments
        SET currency = COALESCE(currency, (SELECT currency FROM trips WHERE trips.id = payments.trip_id)),
            amount_base = COALESCE(amount_base, amount)
      WHERE currency IS NULL OR amount_base IS NULL`
  );
  sqlite.exec("CREATE INDEX IF NOT EXISTS trips_owner_idx ON trips(owner_id);");

  // Roles are gone: being in a trip is one fact now, not two with a permission attached.
  // Dropped rather than ignored — a column called `role` that nothing reads is an
  // invitation for the next person to trust it.
  dropColumn(sqlite, "trip_access", "role");
  dropColumn(sqlite, "invites", "role");

  // One account is at most one participant per trip. Partial, because unlinked members
  // are the common case and SQLite would otherwise treat them as colliding on NULL.
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS members_trip_user_idx ON members(trip_id, user_id) WHERE user_id IS NOT NULL;"
  );

  // Unique per trip, and only where a client id was supplied: SQLite treats NULLs as
  // distinct, so every row written before this existed still fits.
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS expenses_client_idx ON expenses(trip_id, client_id) WHERE client_id IS NOT NULL;"
  );
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS payments_client_idx ON payments(trip_id, client_id) WHERE client_id IS NOT NULL;"
  );

  adoptOrphanTrips(sqlite);
  seedFirstAdmin(sqlite);
  rebaseAmountsToTripCurrency(sqlite);
  once(sqlite, "access-and-seats", () => reconcileAccessAndSeats(sqlite));

  // Sessions and invitations are cheap to clear and there is no other moment that
  // reliably runs.
  sqlite.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  sqlite.prepare("DELETE FROM invites WHERE expires_at < ?").run(Date.now());
  sqlite.prepare("DELETE FROM password_resets WHERE expires_at < ?").run(Date.now());
}

/**
 * Makes the oldest account the admin, and marks every existing account approved.
 *
 * Accounts created before approvals existed have no role and no approval date, which
 * would lock everyone out of their own data — including the person who has been using
 * this all along. Runs on every start and is a no-op once an admin exists.
 */
function seedFirstAdmin(sqlite: Database.Database) {
  const [{ count }] = sqlite
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
    .all() as { count: number }[];
  if (count > 0) return;

  const oldest = sqlite.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (!oldest) return;

  sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(oldest.id);
  sqlite
    .prepare("UPDATE users SET approved_at = created_at WHERE approved_at IS NULL")
    .run();
  console.log("Marked the oldest account as admin and approved existing accounts.");
}

/**
 * Gives ownerless trips to the only account there is.
 *
 * Anonymous trips are gone: everything now belongs to an account. Trips created before
 * that change have no owner, and without this they would simply become unreachable —
 * the data would still be in the file, and nobody could open it.
 *
 * Only runs when there is exactly one account, because with several there is no honest
 * way to guess whose they were. On a fresh install with no accounts there is nothing to
 * adopt, and the first person to register gets them instead.
 */
function adoptOrphanTrips(sqlite: Database.Database) {
  const [{ count }] = sqlite.prepare("SELECT COUNT(*) AS count FROM users").all() as {
    count: number;
  }[];
  if (count !== 1) return;

  const owner = sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: string };
  const result = sqlite
    .prepare("UPDATE trips SET owner_id = ? WHERE owner_id IS NULL")
    .run(owner.id);

  if (result.changes > 0) {
    console.log(`Adopted ${result.changes} ownerless trip(s) into the only account.`);
  }
}

/**
 * Moves stored amounts from euros to each trip's own currency.
 *
 * Three cases, in descending order of how much they can be trusted:
 *
 *   The expense is already in the trip's currency — the great majority — so the amount
 *   as typed is the answer and no rate is involved at all.
 *
 *   The trip is in euros, so the euro figure that was stored is already right.
 *
 *   Anything left is a foreign-currency expense in a foreign-currency trip, and there is
 *   no rate to hand at boot. Rather than invent one, the euro figure is kept and the row
 *   is marked as having no rate, which is what the UI already uses to say a converted
 *   amount is approximate.
 */
function rebaseAmountsToTripCurrency(sqlite: Database.Database) {
  const columns = sqlite.prepare("PRAGMA table_info(expenses)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "amount_eur")) return;

  addColumn(sqlite, "expenses", "amount_base", "REAL");

  const exact = sqlite
    .prepare(
      `UPDATE expenses SET amount_base = amount
         WHERE amount_base IS NULL
           AND currency = (SELECT currency FROM trips WHERE trips.id = expenses.trip_id)`
    )
    .run();

  const euroTrips = sqlite
    .prepare(
      `UPDATE expenses SET amount_base = amount_eur
         WHERE amount_base IS NULL
           AND (SELECT currency FROM trips WHERE trips.id = expenses.trip_id) = 'EUR'`
    )
    .run();

  const approximate = sqlite
    .prepare(
      "UPDATE expenses SET amount_base = amount_eur, rate_available = 0 WHERE amount_base IS NULL"
    )
    .run();

  const total = exact.changes + euroTrips.changes + approximate.changes;
  if (total > 0) {
    console.log(
      `Rebased ${total} expense(s) to their trip's currency ` +
        `(${exact.changes} exact, ${euroTrips.changes} already in euros, ${approximate.changes} approximate).`
    );
  }

  // Dropped rather than left behind: two columns holding "the amount, normalised" is an
  // invitation to read the wrong one.
  sqlite.exec("ALTER TABLE expenses DROP COLUMN amount_eur");
}

/**
 * A repair that runs once against the data that needed it, and never again.
 *
 * The difference matters more than it looks. Everything else in here is a statement
 * about the *shape* of the database, and running it a second time changes nothing — but
 * a repair is a statement about its *contents* at one moment, and re-applying it undoes
 * whatever people have done since. `reconcileAccessAndSeats` learnt this the hard way:
 * it lets every linked member into their trip, which is right once, and on every
 * subsequent boot silently readmitted everybody the owner had taken out. A restart is
 * not a decision to reverse somebody's decision.
 */
function once(sqlite: Database.Database, name: string, repair: () => void) {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS applied_repairs (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`
  );
  if (sqlite.prepare("SELECT 1 FROM applied_repairs WHERE name = ?").get(name)) return;

  repair();
  sqlite
    .prepare("INSERT INTO applied_repairs (name, applied_at) VALUES (?, ?)")
    .run(name, Date.now());
}

/**
 * Being in a trip is one fact, applied to the trips that predate the rule.
 *
 * Run through `once`: this reads the state of everybody's trips at a single moment and
 * corrects it. Repeating it would not be a no-op, it would be an undo.
 *
 * Access and a seat in the split used to be independent: a trip could let somebody in
 * without them appearing in the arithmetic, and could seat an account that could not
 * open the trip. Both halves are repaired here so nobody has to notice the change.
 *
 * The one case deliberately left alone is a trip that still has unlinked members: one
 * of those typed names may well *be* the person waiting, and joining them to a new seat
 * would split one participant into two columns and quietly rewrite what they owe. Those
 * are asked instead, by the same prompt that has always asked.
 */
function reconcileAccessAndSeats(sqlite: Database.Database) {
  // Seated and linked, but never let in: under the old rules, adding somebody by email
  // and granting them access were separate acts, and only one of them had happened.
  const letIn = sqlite
    .prepare(
      `INSERT OR IGNORE INTO trip_access (trip_id, user_id, created_at)
         SELECT m.trip_id, m.user_id, ?
           FROM members m
           JOIN trips t ON t.id = m.trip_id
          WHERE m.user_id IS NOT NULL
            AND m.user_id <> COALESCE(t.owner_id, '')`
    )
    .run(Date.now());

  // Let in, but in nobody's split — the shape the old editor role always produced.
  const unseated = sqlite
    .prepare(
      `SELECT a.trip_id AS tripId, a.user_id AS userId, u.name AS name
         FROM trip_access a
         JOIN users u ON u.id = a.user_id
        WHERE NOT EXISTS (
                SELECT 1 FROM members m
                 WHERE m.trip_id = a.trip_id AND m.user_id = a.user_id)`
    )
    .all() as { tripId: string; userId: string; name: string }[];

  const hasFreeMember = sqlite.prepare(
    "SELECT 1 FROM members WHERE trip_id = ? AND user_id IS NULL LIMIT 1"
  );
  const seatCount = sqlite.prepare("SELECT COUNT(*) AS count FROM members WHERE trip_id = ?");
  const nameTaken = sqlite.prepare(
    "SELECT 1 FROM members WHERE trip_id = ? AND lower(name) = lower(?) LIMIT 1"
  );
  const nextPosition = sqlite.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM members WHERE trip_id = ?"
  );
  const insertMember = sqlite.prepare(
    "INSERT INTO members (id, trip_id, name, emoji, position, user_id) VALUES (?, ?, ?, ?, ?, ?)"
  );

  let seated = 0;
  let asked = 0;
  for (const row of unseated) {
    if (hasFreeMember.get(row.tripId)) {
      asked++;
      continue;
    }
    const { count } = seatCount.get(row.tripId) as { count: number };
    let name = row.name.slice(0, 50);
    for (let n = 2; nameTaken.get(row.tripId, name); n++) name = `${row.name.slice(0, 46)} ${n}`;
    const { next } = nextPosition.get(row.tripId) as { next: number };
    insertMember.run(
      randomBytes(16).toString("hex"),
      row.tripId,
      name,
      EMOJIS[count % EMOJIS.length],
      next,
      row.userId
    );
    seated++;
  }

  if (letIn.changes > 0 || seated > 0 || asked > 0) {
    console.log(
      `Access and seats reconciled: ${letIn.changes} granted access, ${seated} seated, ` +
        `${asked} left for the trip to ask about.`
    );
  }
}

/** ALTER TABLE ADD COLUMN is not idempotent, so check the table shape first. */
function addColumn(sqlite: Database.Database, table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** The same, in reverse: dropping a column that is not there is an error. */
function dropColumn(sqlite: Database.Database, table: string, column: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

export const db = globalThis.__tabup_db__ ?? create();
if (process.env.NODE_ENV !== "production") globalThis.__tabup_db__ = db;

export { DB_PATH };
export * from "./schema";
