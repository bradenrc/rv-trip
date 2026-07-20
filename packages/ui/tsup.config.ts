import { defineConfig } from "tsup";

// Produces a bundlable dist/ (ESM + type declarations) for consumers that build
// against the compiled library — e.g. the design-sync converter. The app itself
// consumes the TS source directly via Next transpilePackages.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "lucide-react", "@rv-trip/core"],
});
