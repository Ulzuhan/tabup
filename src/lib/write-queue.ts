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

export async function pendingFor(tripId: string): Promise<PendingWrite[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const all = await withStore<PendingWrite[]>("readonly", (store) => store.getAll());
    return all.filter((w) => w.tripId === tripId).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    // Private browsing and some locked-down configurations refuse IndexedDB outright.
    // Losing the queue is bad; crashing the page over it is worse.
    return [];
  }
}

export async function allPending(): Promise<PendingWrite[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const all = await withStore<PendingWrite[]>("readonly", (store) => store.getAll());
    return all.sort((a, b) => a.createdAt - b.createdAt);
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
 * A 4xx other than 408/429 means the server actively rejected the write: retrying will
 * never help, so it is dropped rather than left to retry forever. Network failures and
 * 5xx stay queued.
 */
export async function flushQueue(): Promise<{ sent: number; failed: number; dropped: number }> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) {
    return { sent: 0, failed: 0, dropped: 0 };
  }

  flushing = true;
  let sent = 0;
  let failed = 0;
  let dropped = 0;

  try {
    for (const write of await allPending()) {
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
        } else if (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) {
          const data = await res.json().catch(() => ({}));
          await remove(write.clientId);
          dropped++;
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
