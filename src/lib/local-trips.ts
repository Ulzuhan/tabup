"use client";

/**
 * The trips this browser knows about without an account.
 *
 * Anonymous trips are reachable only by their link, so the browser has to remember
 * them or they are lost the moment the tab closes. This list is also what gets offered
 * up for claiming when someone finally registers.
 */

const KEY = "tabup_trips";
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
  return read(KEY);
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
