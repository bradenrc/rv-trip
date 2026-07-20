import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace TS packages are auto-transpiled by Turbopack; list them so a
  // production `next build` (webpack) treats them the same.
  transpilePackages: ["@rv-trip/core", "@rv-trip/db", "@rv-trip/ui"],
  // `pg` does dynamic requires and must not be bundled into the server build.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
