import type { MetadataRoute } from "next";

/**
 * The install manifest (issue #45, item 3). Next serves this at
 * `/manifest.webmanifest` and emits the document link for it — which is also
 * why `proxy.ts:31`'s matcher already excludes `.webmanifest`: the manifest
 * stays readable without a session.
 *
 * A manifest is JSON and cannot carry an `rv-*` token, so the navy is written
 * as a literal WITH its provenance: `#020617` is the value of `--rv-navy` in
 * `packages/ui/styles/entry.css:85` (light) and `:131` (dark) — the same byte
 * in both halves. That is what lets one STATIC `theme_color` work: the chrome
 * is a literal `dark` island at every theme (`Nav.tsx:33`, `:88`), so the OS
 * status bar never has to follow a theme flip and there is no runtime
 * `<meta name="theme-color">` swap to keep in sync.
 *
 * Installable, NOT offline: no `next-pwa`, and nothing in this tree registers
 * a background cache. Offline is out of scope, and a stray registration on
 * localhost has already cost this project a debugging session.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RV Trip Hub",
    short_name: "RV Trip",
    start_url: "/",
    display: "standalone",
    background_color: "#020617", // --rv-navy, verbatim
    theme_color: "#020617", // --rv-navy, verbatim
    icons: [
      // app/icon.svg — Next's file convention serves it at this path.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      // public/icon-maskable.svg — the same mark inset to Android's 80% safe zone.
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
