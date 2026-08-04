import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "path";
import { mkdirSync } from "fs";
import * as schema from "./schema";

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
      role TEXT NOT NULL DEFAULT 'editor',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (trip_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS trip_access_user_idx ON trip_access(user_id);

    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'editor',
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
  addColumn(sqlite, "payments", "client_id", "TEXT");
  addColumn(sqlite, "members", "user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  sqlite.exec("CREATE INDEX IF NOT EXISTS trips_owner_idx ON trips(owner_id);");

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

  // Sessions and invitations are cheap to clear and there is no other moment that
  // reliably runs.
  sqlite.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  sqlite.prepare("DELETE FROM invites WHERE expires_at < ?").run(Date.now());
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

/** ALTER TABLE ADD COLUMN is not idempotent, so check the table shape first. */
function addColumn(sqlite: Database.Database, table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export const db = globalThis.__tabup_db__ ?? create();
if (process.env.NODE_ENV !== "production") globalThis.__tabup_db__ = db;

export { DB_PATH };
export * from "./schema";
