import { describe, it, expect } from "vitest";
import { providerOutcome } from "./provider-outcome";

/**
 * Issue #123 — Apple / Google one-tap sign-in on the phone. Clerk's hooks
 * (`useSignInWithApple`, `useSSO`) return `createdSessionId: null` for two very
 * different reasons: the person backed out (no error text — backing out isn't a
 * failure, wireframe 1b/1f), or the exchange ran but ended without a session
 * (e.g. a sign-up transfer left at `missing_requirements`). The second must
 * surface GENERIC_ERROR through `failed()` rather than silently returning to
 * idle (vet finding, MED).
 */
describe("providerOutcome", () => {
  it("is a session whenever Clerk handed one back", () => {
    expect(providerOutcome({ createdSessionId: "sess_1", attempted: true })).toBe("session");
    expect(
      providerOutcome({ createdSessionId: "sess_1", attempted: true, browserResultType: "success" }),
    ).toBe("session");
  });

  describe("Apple (native sheet, no browser)", () => {
    it("is cancelled when the sheet was dismissed before any exchange", () => {
      expect(providerOutcome({ createdSessionId: null, attempted: false })).toBe("cancelled");
    });

    it("is incomplete when the exchange ran but produced no session", () => {
      expect(providerOutcome({ createdSessionId: null, attempted: true })).toBe("incomplete");
    });
  });

  describe("Google (in-app browser)", () => {
    it("is cancelled when the browser tab was closed or dismissed", () => {
      // signIn.create runs BEFORE the browser opens, so `attempted` is already true.
      for (const type of ["cancel", "dismiss", "locked", "opened"]) {
        expect(
          providerOutcome({ createdSessionId: null, attempted: true, browserResultType: type }),
        ).toBe("cancelled");
      }
    });

    it("is incomplete when the browser came back successfully without a session", () => {
      expect(
        providerOutcome({ createdSessionId: null, attempted: true, browserResultType: "success" }),
      ).toBe("incomplete");
    });

    it("is cancelled when no browser result exists and nothing was attempted", () => {
      expect(
        providerOutcome({ createdSessionId: null, attempted: false, browserResultType: null }),
      ).toBe("cancelled");
    });
  });
});
