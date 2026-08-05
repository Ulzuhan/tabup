"use client";

/**
 * Throws away everything the service worker cached for the previous session.
 *
 * The offline cache is per browser, not per account. Nothing used to clear it, so a
 * trip read on a shared phone stayed on disk after its owner signed out, and the next
 * person to sign in would be handed it the moment the network failed — labelled as
 * offline data, which says nothing about whose it is.
 *
 * Called on the way out and on the way in. On the way in as well because signing out is
 * not the only way the reader changes: a browser can go straight from one account to
 * another, and the second one must not inherit the first one's cached trips.
 *
 * Best effort by design. A browser with no service worker, or one that refuses the
 * message, must not stop somebody from signing in or out.
 */
export function clearSessionCache(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage({ type: "tabup-session-changed" });
    })
    .catch(() => {});
}
