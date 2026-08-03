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

  migrate(sqlite);
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
      amount_eur REAL NOT NULL,
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
  `);

  // Columns added after the first release. CREATE TABLE IF NOT EXISTS above is a no-op
  // on databases that already have the table, so new columns need adding separately.
  addColumn(sqlite, "trips", "owner_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addColumn(sqlite, "members", "user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  sqlite.exec("CREATE INDEX IF NOT EXISTS trips_owner_idx ON trips(owner_id);");

  // Sessions are cheap to clear and there is no other moment that reliably runs.
  sqlite.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
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
