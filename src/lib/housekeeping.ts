import { readdir, stat, unlink, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { lt } from "drizzle-orm";
import { db, expenses, invites, passwordResets, sessions } from "@/db";
import { RECEIPTS_DIR } from "./receipts";
import { logError } from "./errors";

/**
 * Things that pile up if nobody sweeps.
 *
 * All of this was written and none of it ran. `purgeExpiredSessions` was exported and
 * never called from anywhere, so a session row outlived its own expiry until the person
 * happened to come back with the dead cookie in hand. Expired invitations and spent reset
 * links stayed for good. And an uploaded photo that never became an expense — tap the
 * camera, change your mind, close the sheet — sat on disk until the *backup script*
 * noticed it, which is a strange thing to depend on: the backup is a thing you run to
 * copy the data, not the only reason the data does not grow.
 *
 * None of it was a leak of anything. It is a machine under a desk filling up quietly,
 * which is the kind of problem that is invisible for a year and then is not.
 */

/**
 * How long an unattached photo is left alone.
 *
 * It has to survive the gap between uploading it and saving the expense, and that gap can
 * be long: somebody photographs the receipt at the table, the form sits open while the
 * bill is argued over, the phone locks. Six hours is far more than that and far less than
 * forever. Anything referenced by an expense is never touched, whatever its age.
 */
const ORPHAN_AFTER = 6 * 60 * 60 * 1000;

/** Photos on disk that no expense points at, and the empty folders they leave behind. */
async function sweepReceipts(): Promise<number> {
  if (!existsSync(RECEIPTS_DIR)) return 0;

  const referenced = new Set(
    db
      .select({ tripId: expenses.tripId, receipt: expenses.receipt })
      .from(expenses)
      .all()
      .filter((row) => row.receipt)
      .map((row) => `${row.tripId}/${row.receipt}`)
  );

  const cutoff = Date.now() - ORPHAN_AFTER;
  let removed = 0;

  for (const tripDir of await readdir(RECEIPTS_DIR)) {
    const dir = join(RECEIPTS_DIR, tripDir);
    if (!(await stat(dir)).isDirectory()) continue;

    const files = await readdir(dir);
    for (const file of files) {
      if (referenced.has(`${tripDir}/${file}`)) continue;
      const info = await stat(join(dir, file));
      if (info.mtimeMs >= cutoff) continue;
      await unlink(join(dir, file));
      removed++;
    }

    // A trip that was deleted leaves its folder behind; so does one whose photos all go.
    if ((await readdir(dir)).length === 0) await rmdir(dir).catch(() => {});
  }

  return removed;
}

/** Everything with an expiry that has passed. */
function sweepExpired(): number {
  const now = Date.now();
  return (
    db.delete(sessions).where(lt(sessions.expiresAt, now)).run().changes +
    db.delete(invites).where(lt(invites.expiresAt, now)).run().changes +
    db.delete(passwordResets).where(lt(passwordResets.expiresAt, now)).run().changes
  );
}

/**
 * One pass. Never throws: housekeeping failing must not be able to stop the server.
 */
export async function sweep(): Promise<void> {
  try {
    const rows = sweepExpired();
    const photos = await sweepReceipts();
    if (rows || photos) {
      console.log(`[housekeeping] ${rows} expired row(s), ${photos} orphaned photo(s)`);
    }
  } catch (error) {
    logError("housekeeping", error);
  }
}

/**
 * Once at startup, then every six hours.
 *
 * `unref` so this timer is never the reason the process stays alive: a server being asked
 * to stop should stop, not wait for a sweep that is not due for another five hours.
 */
export function startHousekeeping(): void {
  void sweep();
  setInterval(() => void sweep(), 6 * 60 * 60 * 1000).unref();
}
