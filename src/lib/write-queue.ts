"use client";

/**
 * Writes that could not reach the server yet.
 *
 * A trip happens exactly where the network is worst, so an expense typed at a table
 * with no signal has to survive. It goes into IndexedDB, shows up in the list straight
 * away, and is sent when there is a connection again.
 *
 * IndexedDB rather than localStorage because this is the one thing in the app whose
 * loss is not recoverable: everything else can be fetched again from the server, but a
 * queued expense exists nowhere else until it is delivered. localStorage is also
 * synchronous and gets evicted more readily.
 *
 * SCOPE, deliberately: only *creating* expenses and payments queues. Editing and
 * deleting need the server's current state to be meaningful — editing an expense that
 * someone else already changed, or deleting one they already deleted, are conflicts
 * with no good silent answer. Creating is different: it commutes. Two people adding
 * expenses offline both end up with both expenses, in any order, with no conflict at
 * all. That is what makes this tractable without a full sync engine.
 *
 * Every queued write carries a client id, and the server treats a repeat as the same
 * write. Without that, a request that arrived but whose response was lost would be
 * duplicated by the retry — and duplicating a charge is worse than dropping one.
 */

const DB_NAME = "tabup";
const DB_VERSION = 1;
const STORE = "pending-writes";

export type PendingKind = "expense" | "payment";

export interface PendingWrite {
  /** Also the idempotency key sent to the server. */
  clientId: string;
  /**
   * The account that wrote it.
   *
   * IndexedDB belongs to the browser, not to whoever is signed in, and this used to hold
   * nothing about ownership. A phone handed over with an expense still queued replayed it
   * under the next person's session: the server answered 404 for a trip they had no
   * access to, 404 is not retryable, and the write — the one thing in this app that
   * exists nowhere else — was deleted. Watched happen end to end before this was written.
   *
   * Absent only on writes queued before this existed; those are still sent, because
   * stranding somebody's expense forever is the worse of the two mistakes.
   */
  userId?: string;
  tripId: string;
  kind: PendingKind;
  /** The exact request body, ready to send. */
  body: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  /** Last failure, kept so the UI can explain a write that is stuck. */
  lastError?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientId" });
        store.createIndex("tripId", "tripId");
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Random enough that two devices offline at once cannot collide. */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function enqueue(write: Omit<PendingWrite, "attempts">): Promise<void> {
  await withStore("readwrite", (store) => store.put({ ...write, attempts: 0 }));
  notify();
}

/** Whose a queued write is. Anything from before ownership was recorded is everyone's. */
const belongsTo = (write: PendingWrite, userId?: string) =>
  write.userId === undefined || write.userId === userId;

export async function pendingFor(tripId: string, userId?: string): Promise<PendingWrite[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const all = await withStore<PendingWrite[]>("readonly", (store) => store.getAll());
    return all
      .filter((w) => w.tripId === tripId && belongsTo(w, userId))
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    // Private browsing and some locked-down configurations refuse IndexedDB outright.
    // Losing the queue is bad; crashing the page over it is worse.
    return [];
  }
}

export async function allPending(userId?: string): Promise<PendingWrite[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const all = await withStore<PendingWrite[]>("readonly", (store) => store.getAll());
    return all.filter((w) => belongsTo(w, userId)).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function remove(clientId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(clientId));
  notify();
}

async function recordFailure(write: PendingWrite, error: string): Promise<void> {
  await withStore("readwrite", (store) =>
    store.put({ ...write, attempts: write.attempts + 1, lastError: error })
  );
}

// ── Change notification ──────────────────────────────────────────────

const listeners = new Set<() => void>();

export function subscribeToQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

// ── Flushing ─────────────────────────────────────────────────────────

let flushing = false;

/**
 * Sends everything queued, oldest first.
 *
 * Order matters less than it looks — creations commute — but sending in order keeps the
 * result predictable and makes the log readable when something goes wrong.
 *
 * A 4xx means the server rejected the write, and most of those are permanent — a
 * malformed amount will be just as malformed on the tenth attempt — so they are dropped
 * rather than retried forever. Network failures and 5xx stay queued.
 *
 * The exceptions in RETRYABLE are the ones that say "not now" rather than "never".
 * **401 is the important one**: sessions last thirty days and a trip can outlast one,
 * so an expense typed on a mountain could come back to a signed-out browser, get a 401
 * from every queued write, and be deleted — silently, with a console warning nobody
 * reads, in the one module that exists precisely because that data lives nowhere else.
 * Signing in again fixes a 401; nothing fixes a discarded expense.
 */
const RETRYABLE = new Set([401, 403, 408, 429]);

/**
 * How many failures before the app stops calling it "waiting for a connection".
 *
 * `attempts` was recorded from the first day and shown nowhere, so a write stuck behind a
 * 500 looked exactly like one waiting for signal — indefinitely, and with no way to tell
 * the difference from the banner.
 */
export const STUCK_AFTER = 3;

export async function flushQueue(
  /** Only this account's writes are sent. Without one, nothing is: see `PendingWrite`. */
  userId?: string
): Promise<{ sent: number; failed: number; dropped: number }> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) {
    return { sent: 0, failed: 0, dropped: 0 };
  }

  flushing = true;
  let sent = 0;
  let failed = 0;
  let dropped = 0;

  try {
    for (const write of await allPending(userId)) {
      const path = write.kind === "expense" ? "expense" : "payment";
      try {
        const res = await fetch(`/api/trips/${write.tripId}/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...write.body, clientId: write.clientId }),
        });

        if (res.ok) {
          await remove(write.clientId);
          sent++;
        } else if (res.status >= 400 && res.status < 500 && !RETRYABLE.has(res.status)) {
          const data = await res.json().catch(() => ({}));
          await remove(write.clientId);
          dropped++;
          // Reported to the caller as well, which surfaces it to the person who typed
          // it. Money that will never arrive has to be said out loud.
          console.warn(`Dropped a queued write the server refused: ${data.error ?? res.status}`);
        } else {
          await recordFailure(write, `HTTP ${res.status}`);
          failed++;
        }
      } catch (error) {
        await recordFailure(write, error instanceof Error ? error.message : "network");
        failed++;
        // Still offline; the rest will not fare better.
        break;
      }
    }
  } finally {
    flushing = false;
    notify();
  }

  return { sent, failed, dropped };
}
