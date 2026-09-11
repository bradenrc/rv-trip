import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The phone's auth gate (issue #44, item 2) — Clerk Expo behind the same
 * keyless promise the web keeps in `apps/web/src/lib/owner.ts`.
 *
 * The *behaviour* under the gate is a pure function and is tested for real in
 * `api-client/api-client.test.ts` (`bearerAuthHeader`). What cannot be executed
 * here is the wiring: `apps/mobile` has no test runner (`packages/core` is the
 * only package with a `test` script), and every file below is a React Native /
 * expo-router module that needs a native runtime. So — exactly as
 * `mobile-dev-loop.test.ts` (item 1) guards the dev-loop contract and
 * `theme/nightfall-tokens.test.ts` guards two duplicated stylesheets — the
 * structural contract is asserted against the source text.
 *
 * What this guards, criterion for criterion against the item's acceptance:
 *
 *   1. `@clerk/clerk-expo` + `expo-secure-store` are real dependencies.
 *   2. `src/auth.ts` reads the key from `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and
 *      nothing else, and `clerkEnabled` is that key's presence — the mobile
 *      mirror of `clerkEnabled()`.
 *   3. `src/api.ts` never imports Clerk and never names a hook: the client is a
 *      module singleton built before any React tree exists, so the token getter
 *      is handed in from a provider-side effect.
 *   4. `app/_layout.tsx` returns `<Shell />` bare when keyless (no provider
 *      mounted), and the one `<Stack>` in the file lives inside `Shell`, so
 *      `<SignedOut>` cannot reach it.
 *   5. `app/rig.tsx` renders an Account card ABOVE the rig card in both states —
 *      a Sign out when there is a session, the web's dashed `dev-user` stub when
 *      there is not.
 *   6. `README.md` documents the env var and the keyless behaviour, and carries
 *      no real key.
 *
 * What it cannot assert: that `<ClerkProvider>` accepts the token cache, that
 * `expo-secure-store` can write on a simulator, or that the email-code flow
 * completes. Those need a real publishable key on a device — the walk gate's
 * job, and flagged as render-required in docs/design/44/dev-notes.md.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MOBILE = join(REPO, "apps/mobile");

const read = (p: string) => readFileSync(join(MOBILE, p), "utf8");

const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
const auth = read("src/auth.ts");
const apiTs = read("src/api.ts");
const layout = read("app/_layout.tsx");
const signIn = read("app/sign-in.tsx");
const rig = read("app/rig.tsx");
const readme = read("README.md");

/** Every source file the item touches, for the cross-cutting sweeps. */
const sources: [string, string][] = [
  ["src/auth.ts", auth],
  ["src/api.ts", apiTs],
  ["app/_layout.tsx", layout],
  ["app/sign-in.tsx", signIn],
  ["app/rig.tsx", rig],
];

describe("mobile auth · the dependencies", () => {
  it("declares @clerk/clerk-expo and expo-secure-store", () => {
    expect(pkg.dependencies["@clerk/clerk-expo"]).toBeTruthy();
    expect(pkg.dependencies["expo-secure-store"]).toBeTruthy();
  });

  /**
   * `@clerk/clerk-expo` *statically* requires both of these — `expo-web-browser`
   * from `dist/provider/ClerkProvider.js`, and `expo-auth-session` from the
   * `useSSO` / `useOAuth` hooks that `dist/hooks/index.js` re-exports. They are
   * therefore in the runtime module graph the moment anything is imported from
   * the package, even though this app uses neither browser nor OAuth flow — and
   * they are native modules, so they have to autolink into the iOS build rather
   * than sit undeclared in pnpm's store.
   */
  it("declares the native peers Clerk pulls into the graph, SDK-aligned", () => {
    for (const dep of ["expo-web-browser", "expo-auth-session"]) {
      expect(pkg.dependencies[dep], `${dep} must be declared`).toMatch(/^~?57\./);
    }
  });
});

describe("mobile auth · src/auth.ts is the one env check", () => {
  it("reads the key from EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", () => {
    expect(auth).toMatch(/process\.env\.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  });

  it("derives clerkEnabled from that key's presence and nothing else", () => {
    expect(auth).toMatch(/export const clerkEnabled = Boolean\(CLERK_KEY\)/);
  });

  it("is the only file in the app that reads the publishable key", () => {
    for (const [name, src] of sources) {
      if (name === "src/auth.ts") continue;
      expect(src, `${name} must not read the key directly`).not.toMatch(/EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY/);
    }
  });

  it("persists the session token through expo-secure-store", () => {
    expect(auth).toMatch(/from "expo-secure-store"/);
    expect(auth).toMatch(/getToken/);
    expect(auth).toMatch(/saveToken/);
  });

  it("builds the header through core's bearerAuthHeader seam", () => {
    expect(auth).toMatch(/bearerAuthHeader/);
    expect(auth).toMatch(/@rv-trip\/core\/api-client/);
  });
});

describe("mobile auth · src/api.ts keeps hooks out of module scope", () => {
  it("imports nothing from Clerk", () => {
    expect(apiTs).not.toMatch(/@clerk\//);
  });

  it("names no hook at all — the token getter arrives from a provider effect", () => {
    expect(apiTs).not.toMatch(/\buse[A-Z]\w*\(/);
  });

  it("passes the getAuthHeader seam to the client", () => {
    expect(apiTs).toMatch(/getAuthHeader/);
  });
});

describe("mobile auth · app/_layout.tsx is the hard gate", () => {
  it("lifts today's navigator into a Shell component", () => {
    expect(layout).toMatch(/function Shell\(/);
  });

  it("still registers exactly the four screens, and only inside Shell", () => {
    const stacks = layout.match(/<Stack[\s>]/g) ?? [];
    expect(stacks).toHaveLength(1);
    const shellAt = layout.indexOf("function Shell(");
    expect(shellAt).toBeGreaterThan(-1);
    expect(layout.indexOf("<Stack")).toBeGreaterThan(shellAt);
    for (const name of ["index", "trips/[id]/index", "trips/[id]/stops/[stopId]", "rig"]) {
      expect(layout).toContain(`name="${name}"`);
    }
  });

  it("returns Shell bare when keyless — the provider is never mounted", () => {
    const bare = /if \(!clerkEnabled\) return <Shell \/>;/.exec(layout);
    expect(bare).not.toBeNull();
    // …and it short-circuits BEFORE the provider appears in the file.
    expect(layout.indexOf("<ClerkProvider")).toBeGreaterThan(bare!.index);
  });

  it("wraps Shell in SignedIn and the sign-in screen in SignedOut", () => {
    expect(layout).toMatch(/<SignedIn>\s*<Shell \/>\s*<\/SignedIn>/);
    expect(layout).toMatch(/<SignedOut>\s*<SignInScreen \/>\s*<\/SignedOut>/);
  });

  it("hands the provider the publishable key and the secure-store token cache", () => {
    expect(layout).toMatch(/publishableKey=\{CLERK_KEY\}/);
    expect(layout).toMatch(/tokenCache=\{secureStoreTokenCache\}/);
  });
});

describe("mobile auth · app/sign-in.tsx is the email → code screen", () => {
  it("carries the wireframe's copy verbatim", () => {
    expect(signIn).toContain("Plan on the laptop, glance on the phone. Use the same account you use on the web.");
    expect(signIn).toContain("We'll email you a 6-digit code.");
    expect(signIn).toContain("Check your email");
    expect(signIn).toContain("Use a different email");
  });

  it("runs Clerk's email_code strategy — no password, no OAuth", () => {
    expect(signIn).toMatch(/strategy: "email_code"/);
    expect(signIn).not.toMatch(/password/i);
    expect(signIn).not.toMatch(/useSSO|useOAuth/);
  });

  it("is composed from the existing kit, not from new styled primitives", () => {
    expect(signIn).toMatch(/from "\.\.\/src\/ui"/);
    expect(signIn).toMatch(/\bKicker\b/);
    expect(signIn).toMatch(/\bButton\b/);
  });
});

describe("mobile auth · app/rig.tsx gains an Account card", () => {
  it("renders the Account card above the rig card's Routing input kicker", () => {
    expect(rig).toContain("<Kicker>Account</Kicker>");
    const account = rig.indexOf("<AccountCard />");
    const routing = rig.indexOf("<Kicker color={C.accent}>Routing input</Kicker>");
    expect(account).toBeGreaterThan(-1);
    expect(routing).toBeGreaterThan(-1);
    expect(account).toBeLessThan(routing);
  });

  it("offers Sign out with a session and the dashed dev-user stub without one", () => {
    expect(rig).toContain("Sign out");
    expect(rig).toContain("dev-user");
    expect(rig).toContain("No Clerk keys in this build — running as the seeded dev-user. No");
    expect(rig).toMatch(/borderStyle: "dashed"/);
  });

  it("never composes the display name itself — it is Clerk's fullName or the primary email", () => {
    expect(rig).toMatch(/user\?\.fullName \?\? user\?\.primaryEmailAddress\?\.emailAddress/);
    expect(rig).not.toMatch(/firstName/);
  });

  it("branches on the module constant, so the hook order never changes", () => {
    expect(rig).toMatch(/if \(!clerkEnabled\) return <DevAccountCard \/>;/);
  });

  it("leaves the rig rows untouched", () => {
    expect(rig).toContain('["Gross weight", formatPounds(rig.grossWeightKg)]');
    expect(rig).toContain("Edit the rig on the web — this screen is read-only in v1.");
  });
});

describe("mobile auth · the README", () => {
  it("documents the env var and where it goes", () => {
    expect(readme).toMatch(/EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY/);
    expect(readme).toMatch(/\.env\.local/);
  });

  it("states the keyless behaviour — dev-user, no sign-in screen", () => {
    expect(readme).toMatch(/dev-user/);
    expect(readme.toLowerCase()).toMatch(/no sign-in screen|never mounts/);
  });

  it("no longer lists sign-in as missing from v1", () => {
    expect(readme).not.toMatch(/sign-in \(#33\)/);
  });

  it("carries no real key — only a pk_test placeholder", () => {
    expect(readme).not.toMatch(/pk_(test|live)_[A-Za-z0-9]{10}/);
    expect(readme).not.toMatch(/\bsk_(test|live)_/);
  });
});
