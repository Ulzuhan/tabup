import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["fs", "path", "crypto"],
  // Relative to this file rather than an absolute path: the previous value pointed at
  // one particular home directory and would break on any other machine or checkout.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
