import { describe, expect, it } from "vitest";
import {
  ACCEPT_BODY,
  JOIN_CTA,
  NOT_NOW_CTA,
  REFUSAL_TAG,
  SWITCH_ACCOUNT_CTA,
  acceptTitle,
  refusalCopy,
  signedInLabel,
} from "@/components/join/join-view";

/**
 * Everything `/join/<token>` DECIDES, on the runner that exists (#77 ·
 * docs/design/81 §4). apps/web/vitest.config.mts is `environment: "node"` and
 * the workspace has no DOM environment, so — exactly as
 * `settings/household-view.test.ts` does for the Household card — the strings
 * and the branches live in a pure module and are executed here, leaving the two
 * card components with no branch of their own.
 */

describe("acceptTitle", () => {
  it("names the inviter and the household the wireframe way", () => {
    expect(acceptTitle("Braden", "Callahan household")).toBe(
      "Braden invited you to the Callahan household",
    );
  });

  it("falls back when the household still carries the column's default name", () => {
    // Nothing in this epic renames a household, so most of them are still
    // "My household" — and "the My household" is not a sentence.
    expect(acceptTitle("Braden", "My household")).toBe("Braden invited you to their household");
    expect(acceptTitle("Braden", "   ")).toBe("Braden invited you to their household");
  });
});

describe("signedInLabel", () => {
  it("says who you are and when the link dies, in UTC", () => {
    expect(signedInLabel("jess@example.com", new Date("2026-09-26T12:00:00Z"))).toBe(
      "signed in as jess@example.com · invite expires Sep 26",
    );
  });
});

describe("refusalCopy", () => {
  it("draws the wireframe's card for an account that has already planned", () => {
    const copy = refusalCopy("account_not_empty", "Braden");
    expect(copy.tag).toBe(REFUSAL_TAG);
    expect(copy.title).toBe("This account already has trips");
    expect(copy.body).toContain("ask Braden to join yours instead");
    expect(copy.action).toBe("switch-account");
    expect(copy.footer).toBe(
      "the invite is NOT consumed — the link still works for the right account",
    );
  });

  it("has nothing to offer for an expired or a spent link", () => {
    const expired = refusalCopy("invite_expired", "Braden");
    expect(expired.title).toBe("This invite has expired");
    expect(expired.body).toContain("Braden");
    expect(expired.action).toBeNull();

    const used = refusalCopy("invite_used", "Braden");
    expect(used.title).toBe("This invite has already been used");
    expect(used.body).toContain("Braden");
    expect(used.action).toBeNull();
  });

  it("wears the same tag on every refusal", () => {
    for (const code of ["invite_expired", "invite_used", "account_not_empty"] as const) {
      expect(refusalCopy(code, "Braden").tag).toBe(REFUSAL_TAG);
    }
  });
});

describe("the CTAs", () => {
  it("are the wireframe's, verbatim", () => {
    expect(JOIN_CTA).toBe("Join the household");
    expect(NOT_NOW_CTA).toBe("Not now");
    expect(SWITCH_ACCOUNT_CTA).toBe("Use a different account");
    expect(ACCEPT_BODY).toContain("Ratings and notes stay one shared voice");
  });
});
