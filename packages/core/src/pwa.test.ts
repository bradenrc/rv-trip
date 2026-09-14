import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The install contract (issue #45, item 3): a manifest, a viewport, three
 * icons — and NO service worker.
 *
 * Most of this item is data, not JSX, so unlike web-shell.test.ts (i1) and
 * responsive-sweep.test.ts (i2) it is largely EXECUTED, not merely grepped:
 * `app/manifest.ts` is imported and its returned object asserted field by
 * field, the navy it must carry is PARSED out of `packages/ui/styles/entry.css`
 * rather than repeated here (repeating it would only prove this file agrees
 * with itself), and every icon `src` is resolved against the real filesystem.
 *
 * What it cannot assert, because nothing outside a device can: that iOS
 * Add-to-Home-Screen picks the generated apple-touch-icon up, that Android's
 * adaptive mask leaves the maskable mark uncut, or that `viewportFit: "cover"`
 * resolves `env(safe-area-inset-bottom)` to a real inset. Those are the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

const entryCss = read("packages/ui/styles/entry.css");
const globalsCss = read("apps/web/src/app/globals.css");
const layout = read("apps/web/src/app/layout.tsx");
const manifestSrc = read("apps/web/src/app/manifest.ts");
const appleIcon = read("apps/web/src/app/apple-icon.tsx");
const iconSvg = read("apps/web/src/app/icon.svg");
const maskableSvg = read("apps/web/public/icon-maskable.svg");
const proxy = read("apps/web/src/proxy.ts");
const webPkg = JSON.parse(read("apps/web/package.json")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Every `--rv-navy: <value>;` declaration in a stylesheet, light half and dark. */
const navyDecls = (css: string) =>
  [...css.matchAll(/--rv-navy:\s*([^;]+);/g)].map((m) => (m[1] ?? "").trim().split(/\s/)[0]);

const NAVY = navyDecls(entryCss)[0] as string;
const GREEN = (entryCss.match(/--rv-green-on-dark:\s*(#[0-9a-f]{6})/i)?.[1] ?? "").trim();
const RADIUS_MD = Number(entryCss.match(/--radius-rv-md:\s*(\d+)px/)?.[1]);

/** The `d` of every <path> in a file, and the `scale(n)` of every transform. */
const paths = (src: string) => [...src.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1] as string);
const scaleOf = (src: string) => Number(src.match(/scale\(([\d.]+)\)/)?.[1]);

/** lucide's own Compass geometry, when the install is present (it is in CI). */
const lucideCompassD = (() => {
  try {
    const req = createRequire(join(REPO, "apps/web/package.json"));
    const pkg = dirname(req.resolve("lucide-react/package.json"));
    const src = readFileSync(join(pkg, "dist/esm/icons/compass.mjs"), "utf8");
    return src.match(/d:\s*"([^"]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
})();

/** Every file under a directory, node_modules / build output excluded. */
function walk(rel: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(REPO, rel), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".turbo") continue;
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("the navy the manifest has to carry", () => {
  it("is one byte in both halves of the DS, so a STATIC theme_color is honest", () => {
    // Two declarations — the light block and the dark block — same value. This
    // is the premise of the design's Q7: no runtime <meta> swap is needed.
    expect(navyDecls(entryCss)).toEqual(["#020617", "#020617"]);
  });

  it("is mirrored byte-for-byte in the app's own copy of the tokens", () => {
    // rv-* values are duplicated in entry.css and globals.css; if they drift,
    // the manifest's hex silently stops describing what the app paints.
    expect(navyDecls(globalsCss)).toEqual(navyDecls(entryCss));
  });
});

describe("app/manifest.ts", () => {
  it("is the ONLY manifest in apps/web", () => {
    const manifests = walk("apps/web").filter((p) =>
      /(^|\/)manifest\.(ts|tsx|js|json)$|\.webmanifest$/.test(p),
    );
    expect(manifests).toEqual(["apps/web/src/app/manifest.ts"]);
  });

  it("is not shadowed by a hand-written <link rel=\"manifest\">", () => {
    const hand = walk("apps/web/src").filter((p) => /rel="manifest"/.test(read(p)));
    expect(hand).toEqual([]);
  });

  it("returns the vetted MetadataRoute.Manifest", async () => {
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(join(REPO, "apps/web/src/app/manifest.ts")).href
    )) as { default: () => Record<string, unknown> };
    expect(mod.default()).toEqual({
      name: "RV Trip Hub",
      short_name: "RV Trip",
      start_url: "/",
      display: "standalone",
      background_color: NAVY,
      theme_color: NAVY,
      icons: [
        { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      ],
    });
  });

  it("writes the hex with its token provenance, since JSON cannot carry a token", () => {
    expect(manifestSrc).toMatch(/--rv-navy/);
    expect(manifestSrc).toContain('import type { MetadataRoute } from "next"');
  });

  it("every icon src resolves to a file this item actually added", async () => {
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(join(REPO, "apps/web/src/app/manifest.ts")).href
    )) as { default: () => { icons: { src: string }[] } };
    // /icon.svg is Next's app-dir file convention; /icon-maskable.svg is public/.
    const where: Record<string, string> = {
      "/icon.svg": "apps/web/src/app/icon.svg",
      "/icon-maskable.svg": "apps/web/public/icon-maskable.svg",
    };
    for (const { src } of mod.default().icons) {
      expect(where[src], `no file backs ${src}`).toBeTruthy();
      expect(existsSync(join(REPO, where[src] as string)), `${src} missing`).toBe(true);
    }
  });

  it("stays readable without a session — proxy.ts's matcher excludes .webmanifest", () => {
    // Next serves this route at /manifest.webmanifest. If the matcher ever
    // stops excluding it, an install prompt behind Clerk gets a sign-in page.
    expect(proxy).toMatch(/webmanifest/);
  });
});

describe("layout.tsx's viewport export", () => {
  it("exports a typed Viewport beside the existing metadata export", () => {
    expect(layout).toContain('import type { Metadata, Viewport } from "next"');
    expect(layout).toMatch(/export const viewport: Viewport = \{/);
    expect(layout).toMatch(/export const metadata: Metadata = \{/);
  });

  it("carries viewportFit cover — what makes env(safe-area-inset-bottom) real", () => {
    const block = layout.match(/export const viewport: Viewport = \{[\s\S]*?\n\};/)?.[0] ?? "";
    expect(block).toContain('viewportFit: "cover"');
    expect(block).toContain('width: "device-width"');
    expect(block).toContain("initialScale: 1");
    expect(block).toContain(`themeColor: "${NAVY}"`);
  });

  it("does not add a second, drifting theme colour", () => {
    // One navy, in two places (manifest + viewport). Any other hex in either
    // file would be a colour nobody can trace back to a token.
    const hexes = new Set([...`${layout}${manifestSrc}`.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]));
    expect([...hexes]).toEqual([NAVY]);
  });
});

describe("the icons — the masthead's own mark", () => {
  it("app/icon.svg, app/apple-icon.tsx and public/icon-maskable.svg all exist", () => {
    for (const p of [
      "apps/web/src/app/icon.svg",
      "apps/web/src/app/apple-icon.tsx",
      "apps/web/public/icon-maskable.svg",
    ]) {
      expect(existsSync(join(REPO, p)), `${p} missing`).toBe(true);
    }
  });

  it("all three draw the SAME Compass geometry", () => {
    const ds = [iconSvg, maskableSvg, appleIcon].map((s) => paths(s));
    for (const d of ds) expect(d).toHaveLength(1);
    expect(new Set(ds.map((d) => d[0])).size).toBe(1);
  });

  it.skipIf(!lucideCompassD)("and that geometry is lucide's Compass, not a redraw", () => {
    // Nav.tsx:25 renders <Compass/>; these files inline the same path, so this
    // is the guard that a lucide bump does not silently fork the app icon.
    expect(paths(iconSvg)[0]).toBe(lucideCompassD);
  });

  it("uses the two rv-* hexes and nothing else", () => {
    for (const svg of [iconSvg, maskableSvg]) {
      const hexes = new Set([...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]));
      expect([...hexes].sort()).toEqual([NAVY, GREEN].sort());
    }
    expect(GREEN).toBe("#34d399");
  });

  it("icon.svg is the masthead tile: rounded-rv-md on a 32-unit square", () => {
    expect(RADIUS_MD).toBe(6);
    expect(iconSvg).toContain('viewBox="0 0 32 32"');
    expect(iconSvg).toContain(`rx="${RADIUS_MD}"`);
  });

  it("the maskable one bleeds to the edge and insets the mark to the 80% safe zone", () => {
    // No rx: Android's adaptive mask supplies the shape.
    expect(maskableSvg).not.toMatch(/\srx="/);
    expect(maskableSvg).toContain('viewBox="0 0 32 32"');
    expect(scaleOf(maskableSvg)).toBeCloseTo(scaleOf(iconSvg) * 0.8, 5);
  });

  it("apple-icon.tsx generates a 180x180 PNG with next/og", () => {
    expect(appleIcon).toContain('import { ImageResponse } from "next/og"');
    expect(appleIcon).toMatch(/export const size = \{ width: 180, height: 180 \}/);
    expect(appleIcon).toContain('export const contentType = "image/png"');
  });
});

describe("no service worker — offline is out of scope", () => {
  it("nothing under apps/web/src mentions a service worker", () => {
    const hits = walk("apps/web/src").filter((p) => /service.?worker/i.test(read(p)));
    expect(hits).toEqual([]);
  });

  it("no service worker script was dropped into public/", () => {
    const sw = walk("apps/web/public").filter((p) => /(^|\/)(sw|service-worker|workbox)[.-]/i.test(p));
    expect(sw).toEqual([]);
  });

  it("no PWA / service-worker package was added to apps/web", () => {
    const names = [
      ...Object.keys(webPkg.dependencies ?? {}),
      ...Object.keys(webPkg.devDependencies ?? {}),
    ];
    expect(names.filter((n) => /pwa|workbox|service.?worker/i.test(n))).toEqual([]);
  });
});
