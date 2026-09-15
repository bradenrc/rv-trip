import { describe, expect, it } from "vitest";
import {
  INVITE_HELP,
  INVITE_TITLE,
  PENDING_NAME,
  SHARED_HELP,
  SOLO_HELP,
  SOLO_TITLE,
  householdCardState,
  initialOf,
  inviteView,
  inviteWindowLabel,
  joinedLabel,
  memberView,
} from "./household-view";

/**
 * The pure half of the Household card (#77 · docs/design/81 §3, plan item i3).
 *
 * Everything the card DECIDES lives here rather than in the "use client"
 * component, for one blunt reason: this repo has no DOM test environment —
 * apps/web/vitest.config.mts is `environment: "node"` and there is no jsdom,
 * happy-dom or @testing-library anywhere in the workspace. A "renders all
 * three states" acceptance therefore has to be provable as a function of the
 * props, and that is exactly what `householdCardState` is. HouseholdCard.tsx
 * then holds no branch this file does not cover.
 */

const BRADEN = { userId: "user_braden", role: "owner" as const, joinedAt: at("2026-09-01") };
const JESS = { userId: "user_jess", role: "member" as const, joinedAt: at("2026-09-13") };

function at(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

describe("householdCardState — the three states of §3", () => {
  it("is 'solo' with one member and no live invite", () => {
    expect(householdCardState({ memberCount: 1, hasInvite: false })).toBe("solo");
  });

  it("is 'invited' with one member and a live invite", () => {
    expect(householdCardState({ memberCount: 1, hasInvite: true })).toBe("invited");
  });

  it("is 'shared' as soon as there are two members", () => {
    expect(householdCardState({ memberCount: 2, hasInvite: false })).toBe("shared");
  });

  it("stays 'shared' when a stale invite outlives the join", () => {
    // #77 is a couple, not a group (the v1 spec's group exclusion stands): once
    // the second person is in, the card shows the household, never a second
    // seat waiting to be filled.
    expect(householdCardState({ memberCount: 2, hasInvite: true })).toBe("shared");
  });
});

describe("the copy is the wireframe's, verbatim", () => {
  it("names the solo state after what it is, not after what is missing", () => {
    expect(SOLO_TITLE).toBe("Just you");
    expect(SOLO_HELP).toBe(
      "Trips, the places library and your rig are yours alone. Invite your co-pilot " +
        "and you’ll both see — and edit — the same journal.",
    );
  });

  it("says out loud that the link is one use and how long it lasts", () => {
    expect(INVITE_TITLE).toBe("Invite your co-pilot");
    expect(INVITE_HELP).toContain("One use, expires in 14 days.");
  });

  it("promises the shared state carries names", () => {
    expect(SHARED_HELP).toBe(
      "Everything is shared: trips, the places library, and the rig. Changes carry the " +
        "name of whoever made them.",
    );
  });

  it("describes the empty seat as not-yet-opened, never as a person", () => {
    expect(PENDING_NAME).toBe("Invite not yet opened");
  });
});

describe("memberView", () => {
  it("marks the viewer as 'you · owner' and nobody else", () => {
    const mine = memberView(BRADEN, { actor: "user_braden", name: "Braden", email: "b@ex.com" });
    const theirs = memberView(JESS, { actor: "user_braden", name: "Jess", email: "j@ex.com" });

    expect(mine.isYou).toBe(true);
    expect(mine.pill).toBe("you · owner");
    expect(mine.pillTone).toBe("owner");
    expect(theirs.isYou).toBe(false);
    expect(theirs.pill).toBe("joined Sep 13");
    // Green is the app's verified/done colour (StatusPill) — the co-pilot who
    // actually arrived is the only thing on this card that earns it.
    expect(theirs.pillTone).toBe("joined");
  });

  it("labels a co-pilot who is also the viewer as 'you', without the owner word", () => {
    const v = memberView(JESS, { actor: "user_jess", name: "Jess", email: "j@ex.com" });
    expect(v.pill).toBe("you");
  });

  it("falls back to the user id when Clerk cannot name the person", () => {
    const v = memberView(JESS, { actor: "user_braden", name: "", email: "" });
    expect(v.name).toBe("user_jess");
    expect(v.detail).toBe("user_jess");
    expect(v.initial).toBe("U");
  });

  it("takes the initial from the display name, uppercased", () => {
    expect(initialOf("Braden")).toBe("B");
    expect(initialOf("jess")).toBe("J");
    expect(initialOf("")).toBe("?");
  });
});

describe("inviteView", () => {
  const invite = {
    token: "7fD2QK4N",
    createdAt: at("2026-09-12"),
    expiresAt: at("2026-09-26"),
  };

  it("shows the link the way the wireframe draws it — host, no scheme", () => {
    const v = inviteView(invite, "https://roadvalet.com");
    expect(v.display).toBe("roadvalet.com/join/7fD2QK4N");
    expect(v.href).toBe("https://roadvalet.com/join/7fD2QK4N");
  });

  it("keeps a dev origin's port, because that link has to work too", () => {
    expect(inviteView(invite, "http://localhost:3000").display).toBe(
      "localhost:3000/join/7fD2QK4N",
    );
  });

  it("states both ends of the window", () => {
    expect(inviteWindowLabel(invite.createdAt, invite.expiresAt)).toBe(
      "created Sep 12 · expires Sep 26",
    );
  });

  it("formats in UTC, so the label cannot drift with the reader's timezone", () => {
    // A timestamp late on the 12th UTC is still "Sep 12" — a local-time
    // formatter would render "Sep 13" east of Greenwich, and the server and
    // the client would then disagree about the same row.
    expect(joinedLabel(new Date("2026-09-13T23:30:00Z"))).toBe("joined Sep 13");
  });
});
