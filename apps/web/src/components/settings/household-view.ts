import { monthDay } from "@rv-trip/core";
import type { HouseholdRole } from "@rv-trip/db";

/**
 * Everything the Household card DECIDES, as plain functions over plain data
 * (#77 · docs/design/81 §3, plan item i3).
 *
 * Split out of `HouseholdCard.tsx` on purpose. The card's acceptance is that it
 * "renders all three states purely from its props", and this repo has no DOM
 * test environment to prove that by rendering — apps/web/vitest.config.mts is
 * `environment: "node"`, and there is no jsdom, happy-dom or @testing-library
 * anywhere in the workspace. So the state machine and every string it picks
 * live here, where `household-view.test.ts` can execute them on the runner that
 * actually exists, and the component is left with no branch of its own.
 *
 * It is also where the DATES are turned into labels, and that placement is not
 * incidental: the card is a "use client" component, so formatting a `Date`
 * there with a local-time formatter would render one month/day on the server
 * and possibly another in the browser. Every label below is derived in UTC from
 * an ISO date, through core's `monthDay` — the same formatter the planner uses.
 */

/* ── the three states ──────────────────────────────────────────────────── */

export type HouseholdCardState = "solo" | "invited" | "shared";

/**
 * Which of §3's three frames to draw.
 *
 * Two members wins over a live invite. #77 is a couple, not a group (the v1
 * spec's group exclusion stands), so once the second person is in there is no
 * seat left for a pending link to fill — showing one would advertise a door
 * that leads nowhere.
 */
export function householdCardState(household: {
  memberCount: number;
  hasInvite: boolean;
}): HouseholdCardState {
  if (household.memberCount > 1) return "shared";
  return household.hasInvite ? "invited" : "solo";
}

/* ── the copy, verbatim from the wireframe ─────────────────────────────── */

export const SOLO_TITLE = "Just you";
export const SOLO_HELP =
  "Trips, the places library and your rig are yours alone. Invite your co-pilot " +
  "and you’ll both see — and edit — the same journal.";

export const INVITE_TITLE = "Invite your co-pilot";
export const INVITE_HELP =
  "Send her this link. She signs in with her own account and lands in this " +
  "household. One use, expires in 14 days.";

export const SHARED_HELP =
  "Everything is shared: trips, the places library, and the rig. Changes carry the " +
  "name of whoever made them.";

/** The dashed second row of the invite-out state. Never a name: nobody has
 * opened the link yet, and guessing at one would be a lie about who is coming. */
export const PENDING_NAME = "Invite not yet opened";

export const INVITE_CTA = "Invite your co-pilot";
export const CANCEL_CTA = "Cancel invite";
export const COPY_CTA = "Copy link";
export const COPIED_CTA = "Copied";
export const REMOVE_CTA = "Remove";

/** Why the invite button is dead in a keyless process. The `title` is the whole
 * explanation, the way `Account.tsx`'s `DevAccount` stub explains itself. */
export const KEYLESS_HINT =
  "Local dev — no Clerk keys, so there is nobody to invite yet";

/* ── dates ─────────────────────────────────────────────────────────────── */

/** "Sep 12" — UTC, so the label is the same on the server and in the browser. */
export function utcMonthDay(at: Date): string {
  return monthDay(at.toISOString().slice(0, 10));
}

/** "joined Sep 13" — the pill beside a co-pilot who is not you. */
export function joinedLabel(at: Date): string {
  return `joined ${utcMonthDay(at)}`;
}

/** "created Sep 12 · expires Sep 26" — both ends of the 14-day window, so the
 * help line's promise is checkable against the link itself. */
export function inviteWindowLabel(createdAt: Date, expiresAt: Date): string {
  return `created ${utcMonthDay(createdAt)} · expires ${utcMonthDay(expiresAt)}`;
}

/* ── members ───────────────────────────────────────────────────────────── */

export interface HouseholdMemberProps {
  userId: string;
  name: string;
  detail: string;
  initial: string;
  role: HouseholdRole;
  isYou: boolean;
  /** "you · owner" · "you" · "joined Sep 13". */
  pill: string;
  /** Which of the wireframe's pill colours it wears. Navy for you — a neutral
   * statement of fact — and green for a co-pilot who has actually joined, the
   * same green `StatusPill` reserves for verified/done. */
  pillTone: "owner" | "joined";
}

/** The avatar letter. `?` rather than a blank circle when there is no name at
 * all — the dashed pending avatar is the only empty one on this card. */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * One member row's props, from the membership row plus whatever the identity
 * provider could tell us about the person (apps/web/src/lib/members.ts).
 *
 * `household_members` stores no name and no email — it holds the membership and
 * nothing else — so an unnameable person falls back to their user id in BOTH
 * slots rather than rendering a blank line where a name should be.
 */
export function memberView(
  row: { userId: string; role: HouseholdRole; joinedAt: Date },
  person: { actor: string; name: string; email: string },
): HouseholdMemberProps {
  const name = person.name.trim() || row.userId;
  const isYou = row.userId === person.actor;
  return {
    userId: row.userId,
    name,
    detail: person.email.trim() || row.userId,
    initial: initialOf(name),
    role: row.role,
    isYou,
    pill: isYou
      ? row.role === "owner"
        ? "you · owner"
        : "you"
      : joinedLabel(row.joinedAt),
    pillTone: isYou ? "owner" : "joined",
  };
}

/* ── the invite ────────────────────────────────────────────────────────── */

export interface HouseholdInviteProps {
  token: string;
  /** What the field shows: host and path, no scheme — `roadvalet.com/join/…`. */
  display: string;
  /** What "Copy link" puts on the clipboard: the absolute URL. */
  href: string;
  windowLabel: string;
}

/**
 * The join link, both ways it is needed.
 *
 * The scheme is dropped from the DISPLAY only. It is noise in a settings row —
 * and the copied value has to stay absolute, because the whole point is that it
 * is pasted into a message and opened somewhere else. The port survives: a
 * `localhost:3000` link that silently lost its port would not work in dev.
 */
export function inviteView(
  invite: { token: string; createdAt: Date; expiresAt: Date },
  origin: string,
): HouseholdInviteProps {
  const path = `/join/${invite.token}`;
  return {
    token: invite.token,
    display: `${new URL(origin).host}${path}`,
    href: `${origin.replace(/\/+$/, "")}${path}`,
    windowLabel: inviteWindowLabel(invite.createdAt, invite.expiresAt),
  };
}
