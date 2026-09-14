import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace TS packages are auto-transpiled by Turbopack; list them so a
  // production `next build` (webpack) treats them the same.
  transpilePackages: ["@rv-trip/core", "@rv-trip/db", "@rv-trip/ui"],
  // `pg` does dynamic requires and must not be bundled into the server build.
  serverExternalPackages: ["pg"],
  // Pin the workspace root. With two apps in the monorepo Turbopack's root
  // inference is not stable — a `pnpm install` for apps/mobile crashed the
  // running dev server with "couldn't find next/package.json" (issue #31).
  turbopack: { root: path.join(__dirname, "../..") },
  // /settings/people was a scaffolded stub for a feature that is not being
  // built (issue #45 item 5). The page is deleted; the route redirects so an
  // old bookmark lands somewhere useful. A config redirect answers before any
  // React tree renders — permanent, because the route is not coming back.
  async redirects() {
    return [{ source: "/settings/people", destination: "/settings", permanent: true }];
  },
};

export default nextConfig;
