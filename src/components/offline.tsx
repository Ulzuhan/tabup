"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CloudOff } from "lucide-react";

/**
 * Registers the service worker and reports connection state.
 *
 * Registration is deliberately not done in a layout effect on every page: it only has
 * to happen once, and doing it after load keeps it off the critical path.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // updateViaCache: none so a new worker is picked up on the next visit rather than
    // being served from the HTTP cache for a day.
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // A failed registration costs offline support, nothing else. The app works.
    });
  }, []);

  return null;
}

function subscribeToConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * True when the browser reports a connection.
 *
 * `useSyncExternalStore` rather than state plus an effect: connection status is
 * external browser state, and reading it into state on mount is the pattern React now
 * flags, because it renders once with a guessed value and then immediately again.
 * The server snapshot is `true` so the offline banner never flashes during hydration.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    () => true
  );
}

/**
 * Says plainly that the figures on screen are the last ones seen with signal.
 *
 * This app is about money: a balance that is quietly out of date is worse than no
 * balance at all, because it looks exactly like a current one.
 */
export function OfflineBanner({ stale }: { stale?: boolean }) {
  const online = useOnline();
  if (online && !stale) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl border border-warning/25 bg-warning/10 px-4 py-2.5 text-sm text-warning"
    >
      <CloudOff className="size-4 shrink-0" />
      <span>
        {online
          ? "Showing the last data saved on this device."
          : "You are offline. These figures are from the last time you had signal, and new expenses cannot be saved yet."}
      </span>
    </div>
  );
}
