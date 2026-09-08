import {
  isoDate,
  tripCreateInput,
  type IsoDate,
  type Trip,
  type TripCreateInput,
  type TripPatchInput,
  type TripStatus,
} from "./types";
import { daysUntil } from "./trip-status";

/**
 * The two trip forms, as pure functions of what the user typed.
 *
 * The dialog and the create page are React; what they DECIDE is not. Both of
 * them turn a set of fields into a request body, and both have a rule worth
 * pinning: the create page refuses a backwards range, and the settings dialog
 * sends only what changed — an omitted key is a field left alone
 * (`tripPatchInput` is `.partial()`, so a sent `undefined` would be a phantom
 * reset). That decision lives here, where it executes under `vitest`.
 */

/** Trip length in days, counting both ends. `null` when the range is unusable. */
export function tripDayCount(start: string, end: string): number | null {
  if (!isoDate.safeParse(start).success || !isoDate.safeParse(end).success) return null;
  const days = daysUntil(end as IsoDate, start as IsoDate) + 1;
  return days > 0 ? days : null;
}

// ── /trips/new ─────────────────────────────────────────────────────────────

/** What the create form holds. Every field is a string; home base is optional. */
export interface TripDraft {
  title: string;
  startDate: string;
  endDate: string;
  homeBase: string;
}

export const BLANK_TRIP_DRAFT: TripDraft = {
  title: "",
  startDate: "",
  endDate: "",
  homeBase: "",
};

/**
 * The `POST /api/trips` body, or `null` while the form is not submittable —
 * which is also what disables the Create button, so there is one rule, not two.
 */
export function tripDraftInput(draft: TripDraft): TripCreateInput | null {
  if (tripDayCount(draft.startDate, draft.endDate) === null) return null;
  const homeBase = draft.homeBase.trim();
  const parsed = tripCreateInput.safeParse({
    title: draft.title.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate,
    homeBase: homeBase === "" ? null : homeBase,
  });
  return parsed.success ? parsed.data : null;
}

// ── the trip settings dialog ───────────────────────────────────────────────

/** "Automatic" (let the dates decide) or a status the human pinned. */
export type TripStatusChoice = "auto" | TripStatus;

/** What the settings dialog holds. `rating` is 0 for unrated, the way `Stars`
 * renders it; `homeBase`/`note` are "" for null, the way an input holds it. */
export interface TripSettingsDraft {
  startDate: string;
  endDate: string;
  homeBase: string;
  status: TripStatusChoice;
  rating: number;
  note: string;
}

/** The trip, as the dialog's opening state. */
export function tripSettingsDraft(t: Trip): TripSettingsDraft {
  return {
    startDate: t.startDate,
    endDate: t.endDate,
    homeBase: t.homeBase ?? "",
    status: t.statusAuto ? "auto" : t.status,
    rating: t.rating ?? 0,
    note: t.note ?? "",
  };
}

/**
 * The `PATCH /api/trips/:id` body: the keys that actually differ from the trip
 * on screen, and nothing else.
 *
 * Status is the one pair. Choosing a status pins it, so `status` and
 * `statusAuto: false` travel together; choosing Automatic sends `statusAuto`
 * alone and leaves the stored `status` where it is — the derivation ignores it
 * from then on.
 */
export function tripSettingsPatch(t: Trip, d: TripSettingsDraft): TripPatchInput {
  const patch: TripPatchInput = {};

  // A backwards or half-typed range is never sent; the dialog disables Save on
  // it, and dropping it here means a bad date can't ride along with a good note.
  if (tripDayCount(d.startDate, d.endDate) !== null) {
    if (d.startDate !== t.startDate) patch.startDate = d.startDate;
    if (d.endDate !== t.endDate) patch.endDate = d.endDate;
  }

  const homeBase = d.homeBase.trim() === "" ? null : d.homeBase.trim();
  if (homeBase !== t.homeBase) patch.homeBase = homeBase;

  const note = d.note.trim() === "" ? null : d.note;
  if (note !== t.note) patch.note = note;

  const rating = d.rating === 0 ? null : d.rating;
  if (rating !== t.rating) patch.rating = rating;

  if (d.status === "auto") {
    if (!t.statusAuto) patch.statusAuto = true;
  } else if (t.statusAuto || d.status !== t.status) {
    patch.status = d.status;
    patch.statusAuto = false;
  }

  return patch;
}

// ── the delete confirm ─────────────────────────────────────────────────────

/** What a cascading delete takes with it. The client holds the whole tree, so
 * the confirm counts before it opens — never "are you sure?", always the
 * number that is about to go. */
export interface CascadeCounts {
  legs: number;
  stops: number;
  reservations: number;
  ideas: number;
}

/** Everything a `DELETE /api/trips/:id` cascades away (schema.ts FKs). */
export function tripCascadeCounts(t: Trip): CascadeCounts {
  const stops = t.legs.flatMap((l) => l.stops);
  return {
    legs: t.legs.length,
    stops: stops.length,
    reservations: stops.reduce((n, s) => n + s.reservations.length, 0),
    ideas: stops.reduce((n, s) => n + s.ideas.length, 0),
  };
}

function countPhrase(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "Its 2 legs, 2 stops, 3 reservations and 2 ideas are deleted with it. This
 * can't be undone." — zero counts are left out rather than read as "0 ideas". */
export function cascadeLossSentence(c: CascadeCounts): string {
  const parts = [
    c.legs > 0 ? countPhrase(c.legs, "leg") : null,
    c.stops > 0 ? countPhrase(c.stops, "stop") : null,
    c.reservations > 0 ? countPhrase(c.reservations, "reservation") : null,
    c.ideas > 0 ? countPhrase(c.ideas, "idea") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return "This can't be undone.";
  const listed =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Its ${listed} ${parts.length === 1 ? "is" : "are"} deleted with it. This can't be undone.`;
}
