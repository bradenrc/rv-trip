import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Apple + Google one-tap sign-in on the phone (issue #123, resolved q1–q6 = A).
 *
 * The outcome logic is a pure function tested for real in
 * `auth/provider-outcome.test.ts`, and the light-island colours in
 * `theme/tokens.test.ts`. What cannot run here is the wiring: `apps/mobile` has
 * no test runner and `sign-in.tsx` needs a native runtime. So, exactly as
 * `mobile-auth.test.ts` does for #44, the structural contract is asserted
 * against the source text. The provider exchanges themselves (Apple sheet,
 * Google browser round-trip) are render-required — the keyed walk proves them.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MOBILE = join(REPO, "apps/mobile");
const read = (p: string) => readFileSync(join(MOBILE, p), "utf8");

const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
const app = JSON.parse(read("app.json")) as {
  expo: { scheme: string; ios: { usesAppleSignIn?: boolean; bundleIdentifier: string }; plugins: unknown[] };
};
const signIn = read("app/sign-in.tsx");
const layout = read("app/_layout.tsx");

/** The `step === "email"` branch — everything before the code step's kicker. */
const emailStep = signIn.slice(
  signIn.indexOf('step === "email"'),
  signIn.indexOf("Sign in · step 2"),
);

describe("#123 · dependencies + native config", () => {
  it("declares Clerk's Apple peers, SDK-aligned (G1)", () => {
    for (const dep of ["expo-apple-authentication", "expo-crypto"]) {
      expect(pkg.dependencies[dep], `${dep} must be declared`).toMatch(/^~?57\./);
    }
  });

  it("turns on Sign in with Apple and registers its config plugin", () => {
    expect(app.expo.ios.usesAppleSignIn).toBe(true);
    expect(app.expo.plugins).toContain("expo-apple-authentication");
    expect(app.expo.scheme).toBe("tripcaddie");
    expect(app.expo.ios.bundleIdentifier).toBe("com.groupcaddie.tripcaddie");
  });

  it("ships the Google G mark as an asset", () => {
    expect(() => readFileSync(join(MOBILE, "assets/google-g.png"))).not.toThrow();
  });
});

describe("#123 · sign-in.tsx · q1·A stacked layout", () => {
  it("orders Apple, Google, the 'or' divider, then the unchanged email form", () => {
    const apple = emailStep.indexOf("AppleAuthenticationButton");
    const google = emailStep.indexOf("Continue with Google");
    const or = emailStep.indexOf(">or<");
    const form = emailStep.indexOf("<View style={styles.form}>");
    expect(apple).toBeGreaterThan(-1);
    expect(google).toBeGreaterThan(apple);
    expect(or).toBeGreaterThan(google);
    expect(form).toBeGreaterThan(or);
  });

  it("keeps the email step's copy verbatim", () => {
    expect(emailStep).toContain("<Kicker>Email</Kicker>");
    expect(emailStep).toContain('placeholder="you@example.com"');
    expect(emailStep).toContain("We'll email you a 6-digit code.");
    // #147: the email path is core-3's signal API.
    expect(signIn).toMatch(/signIn\.emailCode\.sendCode/);
  });

  it("adds no provider UI to the code step", () => {
    const codeStep = signIn.slice(signIn.indexOf("Sign in · step 2"));
    expect(codeStep).not.toMatch(/AppleAuthenticationButton|Continue with Google/);
  });
});

describe("#123 · sign-in.tsx · Apple (q2·A, q5·A)", () => {
  it("uses Clerk's built-in useSignInWithApple hook — no hand-rolled exchange", () => {
    // @clerk/expo 4.x (#147) moved the hook to its own subpath entry.
    expect(signIn).toMatch(/import \{ useSignInWithApple \} from "@clerk\/expo\/apple";/);
    expect(signIn).toMatch(/startAppleAuthenticationFlow\(/);
    expect(signIn).not.toMatch(/oauth_token_apple/);
  });

  it("renders only on iOS with isAvailableAsync() true, checked once on mount", () => {
    expect(signIn).toMatch(/isAvailableAsync\(\)/);
    expect(signIn).toMatch(/Platform\.OS === "ios" && appleAvailable/);
    expect(signIn).toMatch(/if \(Platform\.OS !== "ios"\) return;/);
  });

  it("is the native button, CONTINUE / WHITE, radius 6, 40 tall", () => {
    expect(signIn).toMatch(/AppleAuthenticationButtonType\.CONTINUE/);
    expect(signIn).toMatch(/AppleAuthenticationButtonStyle\.WHITE/);
    expect(signIn).toMatch(/cornerRadius=\{R\.md\}/);
    expect(signIn).toMatch(/height: 40, width: "100%"/);
  });

  it("dims + deadens while busy instead of relabelling (G4)", () => {
    expect(signIn).toMatch(/pointerEvents=\{busy \? "none" : "auto"\}/);
  });
});

describe("#123 · sign-in.tsx · Google", () => {
  it("runs useSSO with oauth_google and the tripcaddie redirect", () => {
    expect(signIn).toMatch(/import \{[^}]*\buseSSO\b[^}]*\} from "@clerk\/expo";/);
    expect(signIn).toMatch(/strategy: "oauth_google"/);
    expect(signIn).toMatch(/AuthSession\.makeRedirectUri\(\{ scheme: "tripcaddie" \}\)/);
    expect(signIn).toMatch(/WebBrowser\.maybeCompleteAuthSession\(\);/);
  });

  it("carries the wireframe's copy, including the busy label", () => {
    expect(signIn).toContain("Continue with Google");
    expect(signIn).toContain("Opening Google…");
  });

  it("paints from the light-island tokens — no raw hex in the file (G3)", () => {
    expect(signIn).toMatch(/RV_LIGHT_ISLAND\.surface/);
    expect(signIn).toMatch(/RV_LIGHT_ISLAND\.ink/);
    expect(signIn).toMatch(/RV_LIGHT_ISLAND\.borderHi/);
    // A colour literal is a quoted hex string ("#123" in a comment is an issue).
    expect(signIn).not.toMatch(/["'`]#[0-9a-fA-F]{3,8}["'`]/);
  });
});

describe("#123 · sign-in.tsx · outcomes + errors", () => {
  it("routes both providers through core's providerOutcome", () => {
    expect(signIn).toMatch(/providerOutcome\(/);
    expect(signIn).toMatch(/from "@rv-trip\/core"/);
  });

  /**
   * The provider hooks run on Clerk's classic resources, not the email step's
   * signal `signIn` (#147), so "attempted" compares `clerk.client`'s ids taken
   * before the flow against the resources the hook hands back (qa CN, round 1).
   */
  it("derives `attempted` from the hook's returned resources, not a constant", () => {
    expect(signIn).toMatch(/signIn: clerk\.client\?\.signIn\?\.id \?\? null/);
    expect(signIn).toMatch(/signUp: clerk\.client\?\.signUp\?\.id \?\? null/);
    expect(signIn).toMatch(/\(res\.signIn\?\.id \?\? null\) !== before\.signIn/);
    expect(signIn).toMatch(/\(res\.signUp\?\.id \?\? null\) !== before\.signUp/);
    expect(signIn).not.toMatch(/attempted: (true|false)/);
  });

  it("shows GENERIC_ERROR in the provider slot on an incomplete outcome, and activates a session", () => {
    expect(signIn).toMatch(
      /if \(outcome === "incomplete"\) \{\s*setErrorFrom\("provider"\);\s*setError\(GENERIC_ERROR\);\s*\}/,
    );
    expect(signIn).toMatch(
      /if \(outcome === "session"\) \{\s*await clerk\.setActive\(\{ session: res\.createdSessionId \}\);/,
    );
  });

  it("shares one busy flag and one failed() across all three controls", () => {
    expect(signIn).toMatch(/function failed\(e: unknown, from: ErrorFrom = "email"\)/);
    expect(signIn).toMatch(/failed\(e, "provider"\)/);
  });

  it("puts a provider error under the provider stack and an email error in the form", () => {
    expect(signIn).toMatch(/errorFrom === "provider"/);
    expect(signIn).toMatch(/errorFrom === "email"/);
  });
});

describe("#123 · path ⑤ — the keyless walk is untouched", () => {
  it("still returns Shell bare when keyless", () => {
    expect(layout).toMatch(/if \(!clerkEnabled\) return <Shell \/>;/);
  });
});
