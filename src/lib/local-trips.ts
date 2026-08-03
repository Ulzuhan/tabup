"use client";

/**
 * The trips this browser knows about without an account.
 *
 * Anonymous trips are reachable only by their link, so the browser has to remember
 * them or they are lost the moment the tab closes. This list is also what gets offered
 * up for claiming when someone finally registers.
 */

const KEY = "tabup_trips";
/** The key used while the app was called SplitTrip. Read once, then migrated across. */
const LEGACY_KEY = "splittrip_trips";
const MAX = 50;

function read(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    // Corrupt or unavailable storage is not worth crashing the page over.
    return [];
  }
}

export function localTripIds(): string[] {
  if (typeof window === "undefined") return [];

  const current = read(KEY);
  const legacy = read(LEGACY_KEY);
  if (legacy.length === 0) return current;

  // Anonymous trips exist nowhere but here, so dropping the old key on rename would
  // lose them for good. Merge once and retire it.
  const merged = [...new Set([...current, ...legacy])].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable; the merged list is still correct for this page load */
  }
  return merged;
}

export function rememberTrip(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const ids = localTripIds().filter((existing) => existing !== id);
    ids.unshift(id);
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)));
  } catch {
    /* private browsing, quota, or storage disabled */
  }
}

export function forgetTrip(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(localTripIds().filter((x) => x !== id)));
  } catch {
    /* as above */
  }
}

export function forgetTrips(ids: string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return;
  const gone = new Set(ids);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(localTripIds().filter((x) => !gone.has(x))));
  } catch {
    /* as above */
  }
}
