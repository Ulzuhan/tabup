import { readdir, stat, unlink, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { lt } from "drizzle-orm";
import { db, expenses, invites, passwordResets, sessions } from "@/db";
import { RECEIPTS_DIR, runtimeChild } from "./receipts";
import { logError } from "./errors";

/**
 * Things that pile up if nobody sweeps.
 *
 * Two different gaps, and it is worth being exact about which was which.
 *
 * Expired sessions, invitations and spent reset links *were* being cleared — by three
 * statements at the end of the boot migration, which is the comment's own reason: "there
 * is no other moment that reliably runs". True when it was written, and it means a server
 * that stays up for a month keeps a month of dead rows. This is that other moment.
 *
 * The photos were the real gap. An upload that never became an expense — tap the camera,
 * change your mind, close the sheet — sat on disk until the *backup script* noticed it,
 * which is a strange thing to depend on: a backup is what you run to copy the data, not
 * the reason the data stops growing.
 *
 * Neither is a leak of anything. It is a machine under a desk filling up quietly, which is
 * the kind of problem that is invisible for a year and then is not.
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
  if (!existsSync(/* turbopackIgnore: true */ RECEIPTS_DIR)) return 0;

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

  for (const tripDir of await readdir(/* turbopackIgnore: true */ RECEIPTS_DIR)) {
    const dir = runtimeChild(RECEIPTS_DIR, tripDir);
    if (!(await stat(/* turbopackIgnore: true */ dir)).isDirectory()) continue;

    const files = await readdir(/* turbopackIgnore: true */ dir);
    for (const file of files) {
      if (referenced.has(`${tripDir}/${file}`)) continue;
      const info = await stat(/* turbopackIgnore: true */ runtimeChild(dir, file));
      if (info.mtimeMs >= cutoff) continue;
      await unlink(/* turbopackIgnore: true */ runtimeChild(dir, file));
      removed++;
    }

    // A trip that was deleted leaves its folder behind; so does one whose photos all go.
    if ((await readdir(/* turbopackIgnore: true */ dir)).length === 0) await rmdir(/* turbopackIgnore: true */ dir).catch(() => {});
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
declare global {
  var __tabup_housekeeping_started__: boolean | undefined;
}

export function startHousekeeping(): void {
  if (globalThis.__tabup_housekeeping_started__) return;
  globalThis.__tabup_housekeeping_started__ = true;
  void sweep();
  setInterval(() => void sweep(), 6 * 60 * 60 * 1000).unref();
}
