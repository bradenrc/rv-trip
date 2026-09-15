import type { JoinRefusal } from "@rv-trip/db";
import { utcMonthDay } from "@/components/settings/household-view";

/**
 * Everything `/join/<token>` SAYS, as plain functions over plain data
 * (#77 · docs/design/81 §4).
 *
 * Split out of the two card components for the same reason
 * `settings/household-view.ts` is split out of `HouseholdCard`: this repo has
 * no DOM test environment (apps/web/vitest.config.mts is `environment: "node"`,
 * and there is no jsdom or @testing-library in the workspace), so the copy and
 * the branches live where `join-view.test.ts` can execute them and the
 * components are left with no decision of their own.
 *
 * Dates are formatted in UTC through `utcMonthDay`, the same way the Household
 * card formats the invite window — the server renders these strings and the
 * browser must hydrate the identical markup.
 *
 * Nothing here imports a VALUE from `@rv-trip/db`: the accept card is a client
 * component and a value import would pull the pg pool into its bundle. Types
 * are erased, so `JoinRefusal` is safe; the household's default name is
 * mirrored below instead.
 */

/**
 * `households.name`'s DDL default, mirrored from
 * `packages/db/src/queries.ts`'s `DEFAULT_HOUSEHOLD_NAME` rather than imported
 * for the bundle reason above. If that default ever changes, this changes with
 * it — the only consequence is which half of `acceptTitle` renders.
 */
const UNNAMED_HOUSEHOLD = "My household";

/* ── the accept card ───────────────────────────────────────────────────── */

export const ACCEPT_KICKER = "Join a household";

export const ACCEPT_BODY =
  "You’ll both see — and edit — the same trips, the same places library, and the same rig. " +
  "Ratings and notes stay one shared voice; every change carries your name.";

export const JOIN_CTA = "Join the household";
export const NOT_NOW_CTA = "Not now";

/**
 * "Braden invited you to the Callahan household".
 *
 * The wireframe's household is a NAMED one, and nothing in this epic renames a
 * household — `households.name` still carries its DDL default for everybody, and
 * "the My household" is not a sentence. So a household that has not been named
 * drops out of the line and the invitation stays the fact. Flagged for the
 * walk: the second half of this string is the one piece of copy on this surface
 * the wireframe does not draw.
 */
export function acceptTitle(inviter: string, householdName: string): string {
  const named = householdName.trim();
  return named && named !== UNNAMED_HOUSEHOLD
    ? `${inviter} invited you to the ${named}`
    : `${inviter} invited you to their household`;
}

/** "signed in as jess@example.com · invite expires Sep 26" — who this link is
 * about to bind, and how long it lasts, in one mono line. */
export function signedInLabel(who: string, expiresAt: Date): string {
  return `signed in as ${who} · invite expires ${utcMonthDay(expiresAt)}`;
}

/* ── the refusal card ──────────────────────────────────────────────────── */

/** The warning tag every refusal wears — §4 draws it on the one refusal it
 * renders, and the other two are the same card. */
export const REFUSAL_TAG = "Can’t join yet";

export const SWITCH_ACCOUNT_CTA = "Use a different account";

/** Why the "use a different account" button is dead in a keyless process:
 * there is no identity provider to sign out of. The `title` is the whole
 * explanation, as it is on the Household card's invite button. */
export const KEYLESS_SWITCH_HINT =
  "Local dev — no Clerk keys, so there is no account to switch";

export interface RefusalCopy {
  tag: string;
  title: string;
  body: string;
  /** The one action a refusal can offer, or nothing at all. */
  action: "switch-account" | null;
  /** The mono line under the card, when there is something to promise. */
  footer: string | null;
}

/**
 * One refusal card per 409 code.
 *
 * `account_not_empty` is drawn in §4 and is reproduced verbatim, sample name
 * and all — "Braden" there is the INVITER, resolved from the household, not a
 * string to ship (dev note 8).
 *
 * `invite_expired` and `invite_used` are named in §4's contract but never
 * drawn. They are written here in the same card and the same voice, and there
 * is deliberately no button on either: signing in as somebody else does not
 * revive a dead link, and the only way forward is a new one from the person who
 * sent it. Both strings are flagged for the walk as copy the wireframe does not
 * pin.
 */
export function refusalCopy(code: JoinRefusal, inviter: string): RefusalCopy {
  if (code === "account_not_empty") {
    return {
      tag: REFUSAL_TAG,
      title: "This account already has trips",
      body:
        "Joining a household means bringing one shared set of trips, places and a rig — and " +
        `merging two isn’t supported yet. Sign in with an account that hasn’t planned anything, ` +
        `or ask ${inviter} to join yours instead.`,
      action: "switch-account",
      footer: "the invite is NOT consumed — the link still works for the right account",
    };
  }
  if (code === "invite_expired") {
    return {
      tag: REFUSAL_TAG,
      title: "This invite has expired",
      body: `A join link lasts 14 days, and this one is past its date. Ask ${inviter} to send you a new one.`,
      action: null,
      footer: null,
    };
  }
  return {
    tag: REFUSAL_TAG,
    title: "This invite has already been used",
    body: `A join link works once, and this one has been taken. Ask ${inviter} to send you a new one.`,
    action: null,
    footer: null,
  };
}
