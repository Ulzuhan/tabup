import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `web-push` is CommonJS and pulls its crypto helpers in with plain `require`, which
  // the bundler has to resolve at build time and does not always manage. Left external,
  // it is simply required at runtime like any other server dependency.
  serverExternalPackages: ["fs", "path", "crypto", "web-push"],
  // Relative to this file rather than an absolute path: the previous value pointed at
  // one particular home directory and would break on any other machine or checkout.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
