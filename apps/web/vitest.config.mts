import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * The API integration suite (issue #30 §8.3). The repo's first vitest config 
 * outside packages/core — packages/core ships none at all, so there was no
 * precedent to copy.
 *
 * `.mts`, not `.ts`: apps/web is a CJS package (no `"type": "module"`), and
 * vite-tsconfig-paths v5 is ESM-only — vite would try to `require` it out of a
 * `.ts` config and fail to load the file at all.
 *
 * The handlers are called directly (`await PATCH(new Request(…), { params })`),
 * so there is no server, no port and no fetch — hence `environment: "node"`.
 */
export default defineConfig({
  // The "@/…" alias the handlers import each other through.
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    // Serial for now: one run database, one TRUNCATE between tests. A database
    // per VITEST_POOL_ID is the later upgrade Q1 = B buys.
    fileParallelism: false,
    server: {
      deps: {
        // The workspace packages' `exports` point at raw TypeScript
        // (@rv-trip/db -> ./src/index.ts), so vite must transform them rather
        // than hand them to node as-is.
        inline: [/@rv-trip\//],
      },
    },
  },
});
