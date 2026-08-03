#!/usr/bin/env node
/**
 * Imports trips from the old one-JSON-file-per-trip storage into SQLite.
 *
 *   node scripts/migrate-json.mjs [source-directory]
 *
 * Defaults to .splittrip-data, which is where the previous version kept them. Safe
 * to run more than once: trips whose id already exists in the database are skipped,
 * and the JSON files are never modified or deleted.
 */
import Database from "better-sqlite3";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";

const SOURCE = process.argv[2] || ".splittrip-data";
const DB_PATH = process.env.SPLITTRIP_DB || join(process.cwd(), "data", "splittrip.db");

if (!existsSync(SOURCE)) {
  console.log(`Nothing to migrate: ${SOURCE} does not exist.`);
  process.exit(0);
}

const files = readdirSync(SOURCE).filter((f) => f.endsWith(".json") && !f.startsWith("."));
if (files.length === 0) {
  console.log(`Nothing to migrate: no trip files in ${SOURCE}.`);
  process.exit(0);
}

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const exists = db.prepare("SELECT 1 FROM trips WHERE id = ?");
const insertTrip = db.prepare(
  "INSERT INTO trips (id, name, currency, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)"
);
const insertMember = db.prepare(
  "INSERT INTO members (id, trip_id, name, emoji, position) VALUES (?, ?, ?, ?, ?)"
);
const insertExpense = db.prepare(
  `INSERT INTO expenses (id, trip_id, description, amount, currency, amount_eur, paid_by, category, date, exchange_rate, rate_available)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertSplit = db.prepare(
  "INSERT INTO expense_splits (expense_id, member_id, share) VALUES (?, ?, ?)"
);
const insertPayment = db.prepare(
  "INSERT INTO payments (id, trip_id, from_member, to_member, amount, date, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

let imported = 0;
let skipped = 0;

for (const file of files) {
  let trip;
  try {
    trip = JSON.parse(readFileSync(join(SOURCE, file), "utf-8"));
  } catch {
    console.warn(`  ! ${file}: not valid JSON, skipped`);
    continue;
  }

  if (!trip?.id) {
    console.warn(`  ! ${file}: no trip id, skipped`);
    continue;
  }
  if (exists.get(trip.id)) {
    skipped++;
    continue;
  }

  // One transaction per trip: a malformed file cannot leave half a trip behind.
  const migrate = db.transaction(() => {
    const now = Date.now();
    insertTrip.run(
      trip.id,
      trip.name ?? "Trip",
      trip.currency ?? "EUR",
      trip.createdAt ?? now,
      now,
      trip.version ?? 1
    );

    const memberIds = new Set();
    (trip.members ?? []).forEach((m, i) => {
      insertMember.run(m.id, trip.id, m.name, m.emoji ?? "😊", i);
      memberIds.add(m.id);
    });

    for (const e of trip.expenses ?? []) {
      // Expenses paid by someone who no longer exists would violate the foreign key.
      if (!memberIds.has(e.paidBy)) continue;

      insertExpense.run(
        e.id ?? randomBytes(16).toString("hex"),
        trip.id,
        e.description ?? "",
        e.amount ?? 0,
        e.currency ?? trip.currency ?? "EUR",
        e.amountEur ?? e.amount ?? 0,
        e.paidBy,
        e.category ?? "other",
        e.date ?? now,
        e.exchangeRate ?? null,
        e.rateAvailable === false ? 0 : 1
      );

      // splitAmong + optional splitShares collapse into one row per participant.
      for (const memberId of e.splitAmong ?? []) {
        if (!memberIds.has(memberId)) continue;
        insertSplit.run(e.id, memberId, e.splitShares?.[memberId] ?? 1);
      }
    }

    for (const p of trip.payments ?? []) {
      if (!memberIds.has(p.from) || !memberIds.has(p.to)) continue;
      insertPayment.run(
        p.id ?? randomBytes(16).toString("hex"),
        trip.id,
        p.from,
        p.to,
        p.amount ?? 0,
        p.date ?? now,
        p.note ?? null
      );
    }
  });

  try {
    migrate();
    imported++;
    console.log(`  ✓ ${trip.name} (${trip.expenses?.length ?? 0} expenses)`);
  } catch (error) {
    console.error(`  ✗ ${file}: ${error.message}`);
  }
}

console.log(`\n${imported} trips imported, ${skipped} already present.`);
console.log(`The JSON files in ${SOURCE} were left untouched.`);
