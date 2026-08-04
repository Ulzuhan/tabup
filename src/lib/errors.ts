import { randomBytes } from "crypto";
import { desc, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { errorLog } from "@/db/schema";

/**
 * Where server failures go.
 *
 * They used to go to `console.error` and no further, which on a machine under the desk
 * means the systemd journal — so the only way to find out that receipt scanning or the
 * exchange rates had broken was to hit it yourself while using the app. Recording them
 * puts them somewhere the admin can actually look.
 *
 * Writing a log entry must never be the reason a request fails, so everything here
 * swallows its own errors. A logger that can throw turns a handled 500 into an unhandled
 * one, which is worse than the failure it was trying to describe.
 */

/** Beyond this the oldest go; enough to see a pattern, not enough to grow forever. */
const MAX_ROWS = 500;

/** A stack is useful for the first few frames and noise after that. */
function trimStack(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  return error.stack.split("\n").slice(0, 6).join("\n").slice(0, 2000);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (typeof error === "string") return error.slice(0, 500);
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return String(error).slice(0, 500);
  }
}

/**
 * Records a failure, collapsing repeats of the same one onto a single row.
 *
 * `context` should say what was being attempted — "POST /api/trips/[id]/expense",
 * "receipt OCR" — because that plus the message is what makes two failures the same
 * failure. It is deliberately not the stack: the same bug reached from two routes is two
 * things worth seeing separately, and the same route failing a hundred times is one.
 */
export function logError(context: string, error: unknown): void {
  // Still goes to the journal: a database that will not accept writes is exactly the
  // situation where the log table is no help.
  console.error(`[${context}]`, error);

  try {
    const now = Date.now();
    db.insert(errorLog)
      .values({
        id: randomBytes(16).toString("hex"),
        context: context.slice(0, 200),
        message: messageOf(error),
        stack: trimStack(error),
        firstSeen: now,
        lastSeen: now,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [errorLog.context, errorLog.message],
        set: {
          lastSeen: now,
          count: sql`${errorLog.count} + 1`,
          stack: trimStack(error),
          // A failure that comes back after being dismissed is news again.
          acknowledgedAt: null,
        },
      })
      .run();

    prune();
  } catch {
    // Nothing sensible to do: the journal line above already happened.
  }
}

/** Keeps the table bounded, dropping the least recently seen. */
function prune(): void {
  const rows = db.select({ lastSeen: errorLog.lastSeen }).from(errorLog).all();
  if (rows.length <= MAX_ROWS) return;

  const cutoff = rows
    .map((r) => r.lastSeen)
    .sort((a, b) => b - a)[MAX_ROWS - 1];
  db.delete(errorLog).where(lt(errorLog.lastSeen, cutoff)).run();
}

export function recentErrors(limit = 100) {
  return db.select().from(errorLog).orderBy(desc(errorLog.lastSeen)).limit(limit).all();
}

/** Marks one as seen, or every one when no id is given. */
export function acknowledgeErrors(id?: string): void {
  const now = Date.now();
  if (id) {
    db.update(errorLog).set({ acknowledgedAt: now }).where(sql`${errorLog.id} = ${id}`).run();
    return;
  }
  db.update(errorLog).set({ acknowledgedAt: now }).run();
}

export function clearErrors(): void {
  db.delete(errorLog).run();
}
