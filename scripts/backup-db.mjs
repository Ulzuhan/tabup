#!/usr/bin/env node
/**
 * Takes a consistent snapshot of the database.
 *
 *   node scripts/backup-db.mjs [destination-directory]
 *
 * Uses SQLite's own backup API rather than copying the file. In WAL mode the `.db`
 * file on its own is not the current state — recent commits live in `-wal` until a
 * checkpoint — so `cp tabup.db` while the server is running produces a snapshot that
 * is missing writes, or is outright corrupt if a checkpoint lands mid-copy. The backup
 * API reads through the same locking the server uses, so the server can keep serving.
 *
 * Every snapshot is verified with an integrity check before the old ones are rotated
 * out: a backup nobody has ever restored is a guess, and rotating on the strength of a
 * corrupt file would quietly destroy the good ones.
 *
 * Environment:
 *   TABUP_DB              database to back up
 *   TABUP_BACKUP_DIR      where snapshots go (default ~/backups/tabup)
 *   TABUP_BACKUP_KEEP     how many to keep (default 14)
 *   TABUP_BACKUP_REMOTE   optional rsync target, e.g. user@host:/path
 */
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const DB_PATH = process.env.TABUP_DB || join(process.cwd(), "data", "tabup.db");
const DEST_DIR =
  process.argv[2] || process.env.TABUP_BACKUP_DIR || join(homedir(), "backups", "tabup");
const KEEP = Number(process.env.TABUP_BACKUP_KEEP || 14);
const REMOTE = process.env.TABUP_BACKUP_REMOTE?.trim();

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}`);
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });

const snapshot = join(DEST_DIR, `tabup-${stamp}.db`);
const compressed = `${snapshot}.gz`;

// ── Snapshot ─────────────────────────────────────────────────────────
const source = new Database(DB_PATH, { readonly: true });
await source.backup(snapshot);
source.close();

// ── Verify before touching anything older ────────────────────────────
const copy = new Database(snapshot, { readonly: true });
const integrity = copy.pragma("integrity_check", { simple: true });
const trips = copy.prepare("SELECT COUNT(*) AS n FROM trips").get().n;
const expenses = copy.prepare("SELECT COUNT(*) AS n FROM expenses").get().n;
copy.close();

/** Opening the snapshot to verify it leaves -wal/-shm sidecars next to it. */
const cleanup = () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${snapshot}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
};

if (integrity !== "ok") {
  console.error(`Integrity check failed: ${integrity}`);
  cleanup();
  process.exit(1);
}

await pipeline(createReadStream(snapshot), createGzip({ level: 9 }), createWriteStream(compressed));
cleanup();

const size = statSync(compressed).size;
log(`${compressed} — ${trips} trips, ${expenses} expenses, ${(size / 1024).toFixed(1)} KiB`);

// ── Orphan photos ────────────────────────────────────────────────────
// A photo is stored the moment it is scanned, before the expense exists, so abandoning
// the form leaves one behind. Anything older than a day that no expense points at is
// swept up here rather than accumulating forever. The age check is what stops a scan in
// progress from being deleted out from under the person doing it.
{
  const referenced = new Set(
    new Database(DB_PATH, { readonly: true })
      .prepare("SELECT trip_id, receipt FROM expenses WHERE receipt IS NOT NULL")
      .all()
      .map((r) => `${r.trip_id}/${r.receipt}`)
  );

  const root = join(DB_PATH, "..", "receipts");
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let orphans = 0;

  if (existsSync(root)) {
    for (const tripDir of readdirSync(root)) {
      const dir = join(root, tripDir);
      if (!statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir)) {
        if (referenced.has(`${tripDir}/${file}`)) continue;
        if (statSync(join(dir, file)).mtimeMs < cutoff) {
          unlinkSync(join(dir, file));
          orphans++;
        }
      }
    }
  }
  if (orphans) log(`removed ${orphans} orphaned photo${orphans === 1 ? "" : "s"}`);
}

// ── Receipt photos ───────────────────────────────────────────────────
// The database records which photo belongs to which expense, but the photos themselves
// live on disk. Backing up only the database would restore a trip whose receipts are
// all broken images, so they travel together.
const receiptsDir = join(DB_PATH, "..", "receipts");
if (existsSync(receiptsDir)) {
  const archive = join(DEST_DIR, `receipts-${stamp}.tar.gz`);
  try {
    await execFileAsync("tar", ["-czf", archive, "-C", join(DB_PATH, ".."), "receipts"]);
    log(`${archive} — ${(statSync(archive).size / 1024 / 1024).toFixed(1)} MiB of photos`);
  } catch (error) {
    // A failed photo archive must not lose the database snapshot that already succeeded.
    console.error(`Receipt archive failed: ${error.message}`);
  }
}

// ── Offsite copy, when one is configured ─────────────────────────────
if (REMOTE) {
  try {
      await execFileAsync("rsync", ["-a", "--timeout=60", compressed, REMOTE]);
    log(`copied to ${REMOTE}`);
  } catch (error) {
    // A failed offsite copy must not fail the run: the local snapshot is already
    // taken and verified, and losing it too would be the worse outcome.
    console.error(`Offsite copy failed: ${error.message}`);
  }
}

// ── Rotate ───────────────────────────────────────────────────────────
const old = readdirSync(DEST_DIR)
  .filter((f) => f.startsWith("tabup-") && f.endsWith(".db.gz"))
  .sort()
  .slice(0, -KEEP);

const oldPhotos = readdirSync(DEST_DIR)
  .filter((f) => f.startsWith("receipts-") && f.endsWith(".tar.gz"))
  .sort()
  .slice(0, -KEEP);

for (const file of [...old, ...oldPhotos]) unlinkSync(join(DEST_DIR, file));
if (old.length) log(`removed ${old.length} snapshot${old.length === 1 ? "" : "s"} beyond the last ${KEEP}`);
