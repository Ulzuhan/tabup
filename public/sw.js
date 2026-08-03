/**
 * TabUp service worker.
 *
 * Its whole job is that a trip stays readable without a connection — on a plane, on a
 * mountain, or on roaming you would rather not pay for.
 *
 * Three rules, and the split between them matters:
 *
 *   Static assets → cache first. Build output is content-hashed, so serving it
 *   instantly is free and always correct.
 *
 *   Pages → network first. What a page contains depends on who is asking: the front
 *   door is a landing for a stranger and the trip list for somebody signed in, so a
 *   shared cached copy would show one person another's view.
 *
 *   API reads → network first, cache only as a fallback. Balances are the reason this
 *   app exists; showing a stale figure as if it were current would be worse than
 *   showing nothing. The cached copy is a last resort and the UI says so.
 *
 * Writes are never queued or replayed. A POST that failed offline stays failed and the
 * user is told. Silently retrying an expense later — after the amounts around it have
 * moved on — is how you end up with duplicated or contradictory data in the one place
 * where people are counting on the numbers.
 */

const VERSION = "tabup-v2";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

/** Enough to boot the app offline; everything else arrives through the fetch handler. */
const PRECACHE = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // A single missing entry must not fail the whole install, so they are added
      // individually and failures are tolerated.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

const isApiRead = (url) => url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/");

/** Build output is content-hashed, so it can be cached hard. */
const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.endsWith(".png") ||
  url.pathname.endsWith(".svg") ||
  url.pathname.endsWith(".ico");

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Session state must never come from a cache: a stale /api/auth/me would show the
  // wrong person as signed in.
  if (url.pathname.startsWith("/api/auth/")) return;

  if (isApiRead(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    // Network first for pages, not cache first.
    //
    // What the page contains now depends on who is asking: the front door is a landing
    // for a stranger and the trip list for somebody signed in. Serving a cached copy
    // meant signing in and still being shown the landing, because the shell that was
    // stored belonged to a different session. The cache stays as the offline fallback.
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DATA);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      // Flagged so the page can say the figures are from the last time it had signal,
      // rather than passing them off as current.
      const headers = new Headers(cached.headers);
      headers.set("X-TabUp-Offline", "1");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    return new Response(JSON.stringify({ error: "Offline and nothing cached for this trip" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "X-TabUp-Offline": "1" },
    });
  }
}

/**
 * Pages: the network decides, the cache catches a fall.
 *
 * Only successful responses are stored, so an error page never becomes the thing shown
 * offline forever.
 */
async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const root = await caches.match("/");
    if (root) return root;

    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);

  const update = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(SHELL);
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const fresh = await update;
  if (fresh) return fresh;

  // A navigation with nothing cached at all: fall back to the app root, which is
  // precached, so the user gets the app instead of the browser's error page.
  if (request.mode === "navigate") {
    const shell = await caches.match("/");
    if (shell) return shell;
  }

  return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}
