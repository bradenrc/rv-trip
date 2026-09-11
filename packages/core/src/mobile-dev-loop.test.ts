import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The phone's dev-loop contract (issue #44, item 1) — Expo Go is retired.
 *
 * `@rnmapbox/maps` (#32) is a native module behind an Expo config plugin, so
 * the only loop that can run every screen is a native **development build**:
 * `expo run:ios`. That decision lives in two files and nowhere else —
 * `apps/mobile/package.json`'s `ios` script and `apps/mobile/README.md` — and
 * neither is reachable from a runtime test: the mobile app has no test runner
 * and `packages/core` is the only package that does. So, exactly as
 * `theme/nightfall-tokens.test.ts` guards the two duplicated stylesheets and
 * `theme/map-palette.test.ts` guards an app module it cannot import, the
 * contract is asserted here against the source text.
 *
 * What this guards:
 *
 *   1. `pnpm --filter @rv-trip/mobile ios` really is `expo run:ios` (a native
 *      build), and `start` is still plain `expo start` (attach Metro to the
 *      already-installed dev client).
 *   2. The README instructs **no Expo Go path**: no command that launches it,
 *      and every remaining mention of the name says it is gone.
 *   3. The README names what a fresh machine has to do once — Xcode and
 *      CocoaPods — and carries no Mapbox credential of any kind. Item 1 wrote
 *      the `sk.*` / `~/.netrc` `DOWNLOADS:READ` token here as "needed from #32
 *      onward"; #32 landed in item 4 and it is **not**: `@rnmapbox/maps@10.3.5`
 *      pulls MapboxMaps iOS `~> 11.23.1` from the public CocoaPods registry and
 *      its own podspec calls `$RNMapboxMapsDownloadToken` deprecated ("download
 *      token is no longer required"). So the claim this guards is the corrected
 *      one, and the secret-leak guard now covers both token families.
 *   4. The cache guidance names what is actually shared between worktrees (the
 *      CocoaPods caches, Xcode's shared module cache) and what is not
 *      (`apps/mobile/ios/`, which `.gitignore` regenerates per tree). That last
 *      premise is asserted against `.gitignore` itself: un-ignore `/ios` and
 *      the README's claim changes, so this reds instead of the doc going stale.
 *
 * What it cannot assert: that the build succeeds, that `pod install` resolves,
 * or that `Constants.expoConfig?.hostUri` is populated in a dev client. Those
 * are the walk gate's job on a simulator.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MOBILE = join(REPO, "apps/mobile");

const read = (p: string) => readFileSync(join(MOBILE, p), "utf8");

const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const readme = read("README.md");
const gitignore = read(".gitignore");
const rootReadme = readFileSync(join(REPO, "README.md"), "utf8");

/** Lines inside ``` fences — i.e. the things a reader copies and runs. */
function fencedLines(md: string): string[] {
  return split(md).fenced;
}

/**
 * Prose sentences, fences removed. Sentence-granular, not line-granular: the
 * README hard-wraps at ~78 columns, so a claim about Expo Go and the reason it
 * is gone routinely straddle two lines.
 */
function proseSentences(md: string): string[] {
  return split(md)
    .prose.join(" ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.:])\s+/);
}

function split(md: string): { fenced: string[]; prose: string[] } {
  const fenced: string[] = [];
  const prose: string[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    (inFence ? fenced : prose).push(line);
  }
  return { fenced, prose };
}

describe("the mobile dev loop is a native dev client", () => {
  it("`ios` builds and runs a dev client; `start` only attaches Metro", () => {
    expect(pkg.scripts.ios).toBe("expo run:ios");
    expect(pkg.scripts.start).toBe("expo start");
  });

  it("the README's run command is the one package.json defines", () => {
    expect(readme).toContain("expo run:ios");
    expect(readme).toContain("pnpm --filter @rv-trip/mobile ios");
  });
});

describe("the README instructs no Expo Go path", () => {
  it("no runnable line launches Expo Go", () => {
    const runnable = fencedLines(readme);
    expect(runnable.filter((l) => /Expo Go/i.test(l))).toEqual([]);
    // `expo start --ios` / `--android` is the Expo Go launcher.
    expect(runnable.filter((l) => /expo start\s+--(ios|android)/.test(l))).toEqual([]);
  });

  it("the repo README's phone line does not send anyone to Expo Go either", () => {
    const phoneLine = rootReadme.slice(rootReadme.indexOf("Phone:"));
    expect(phoneLine).toContain("pnpm --filter @rv-trip/mobile ios");
    expect(phoneLine.split("\n").slice(0, 5).join(" ")).not.toMatch(/Expo Go/);
  });

  it("every prose mention says Expo Go is gone", () => {
    const mentions = proseSentences(readme).filter((s) => /Expo Go/.test(s));
    expect(mentions.length).toBeGreaterThan(0); // silence is not the same as saying so
    for (const sentence of mentions) {
      expect(sentence, `"${sentence}" must say Expo Go is gone, not how to use it`).toMatch(
        /retired|cannot|no Expo Go/i,
      );
    }
  });
});

describe("the README names the one-time machine setup", () => {
  it("Xcode and CocoaPods", () => {
    expect(readme).toMatch(/Xcode/);
    expect(readme).toMatch(/CocoaPods/);
    expect(readme).toMatch(/pod install/);
  });

  it("says plainly that no Mapbox download token is needed", () => {
    expect(readme).toMatch(/no Mapbox download token/i);
    // …and names where it WOULD come from if a future SDK bump brings it back:
    // an environment variable, never app.json (which the plugin would copy into
    // the generated Podfile).
    expect(readme).toContain("RNMAPBOX_MAPS_DOWNLOAD_TOKEN");
  });

  it("carries no real Mapbox token of either family", () => {
    // Both are JWTs: `sk.eyJ…` secret, `pk.eyJ…` public. Placeholders only.
    expect(readme).not.toMatch(/sk\.ey[A-Za-z0-9_-]/);
    expect(readme).not.toMatch(/pk\.ey[A-Za-z0-9_-]/);
  });
});

describe("the cache guidance says what is actually shared", () => {
  it("names the machine-global caches", () => {
    expect(readme).toContain("~/Library/Developer/Xcode/DerivedData");
    expect(readme).toMatch(/~\/Library\/Caches\/CocoaPods|~\/\.cocoapods/);
  });

  it("does not promise a shared ios/Pods — .gitignore regenerates ios/ per worktree", () => {
    expect(gitignore.split("\n").map((l) => l.trim())).toContain("/ios");
    expect(readme).toMatch(/per worktree|each worktree|every worktree/i);
  });
});
