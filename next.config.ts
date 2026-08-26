import type { NextConfig } from "next";

/**
 * What the browser is told about this app, besides its HTML.
 *
 * There were no security headers at all, which for a page reachable from the internet
 * means the browser applies none of the cheap defences it already knows how to apply.
 * None of these fix a bug in this code; they bound what a bug would be worth.
 */
const SECURITY_HEADERS = [
  /** For anything that still reads the older header rather than frame-ancestors. */
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  /**
   * An invitation is a token in the path — /join/<token> — and a referrer carries the
   * whole path. Nothing here links off-site today, but the day something does, that link
   * must not hand the trip away in a header.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  /**
   * Camera stays allowed: a receipt is photographed from this page. The rest are things
   * this app has never asked for, and a page that cannot ask cannot be tricked into it.
   */
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // `web-push` is CommonJS and pulls its crypto helpers in with plain `require`, which
  // the bundler has to resolve at build time and does not always manage. Left external,
  // it is simply required at runtime like any other server dependency.
  serverExternalPackages: ["fs", "path", "crypto", "web-push"],
  // Relative to this file rather than an absolute path: the previous value pointed at
  // one particular home directory and would break on any other machine or checkout.
  outputFileTracingRoot: import.meta.dirname,
  // Runtime state must never be copied into a deployment artifact.
  outputFileTracingExcludes: { "**": ["./data/**/*"] },
  // Announcing the framework and its version helps nobody who is welcome here.
  poweredByHeader: false,
  headers: () => [{ source: "/:path*", headers: SECURITY_HEADERS }],
};

export default nextConfig;
