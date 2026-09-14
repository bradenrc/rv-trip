import type { PickedPlace } from "../providers/place-picker";
import { placeOf } from "./place-form";
import {
  isoDate,
  type Idea,
  type IdeaCreateInput,
  type IdeaPatchInput,
  type IsoDate,
  type Reservation,
  type ReservationCreateInput,
  type ReservationPatchInput,
  type ReservationType,
  type Place,
} from "./types";
import { tripDayCount } from "./trip-form";

/**
 * The two LEAF forms — reservation and idea — as pure functions of what the
 * user typed.
 *
 * Same seam as `trip-form.ts`: the sheet is React, what it DECIDES is not. The
 * rules worth pinning are (a) an empty cost field means "no cost recorded",
 * never zero; (b) the edit form sends only the keys that moved, because
 * `reservationPatchInput` is `.partial()` and a sent `undefined` would be a
 * phantom reset; and (c) an undone delete re-POSTs the WHOLE row — the DELETE
 * has already committed, so anything the create body cannot carry is lost.
 */

/** The delete toast's window. The row is already gone server-side; this is how
 * long "Undo" is on screen to re-POST it. */
export const UNDO_WINDOW_MS = 6000;

// ── the reservation form ───────────────────────────────────────────────────

/** What the reservation form holds. Every field is a string, the way an input
 * holds it; "" is the empty/null state for all but `type`. */
export interface ReservationDraft {
  type: ReservationType;
  name: string;
  checkIn: string;
  checkOut: string;
  confirmationNumber: string;
  cost: string;
}

export const BLANK_RESERVATION_DRAFT: ReservationDraft = {
  type: "campground",
  name: "",
  checkIn: "",
  checkOut: "",
  confirmationNumber: "",
  cost: "",
};

/**
 * The cost field. `null` is "no cost recorded" (an empty field — planning
 * without money in your face is the default), and `undefined` is "not a cost",
 * which is what disables Save. Zero is a real, free reservation.
 */
export function reservationCost(input: string): number | null | undefined {
  const t = input.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** "" for null, so a text field can hold it. */
function text(v: string | null): string {
  return v ?? "";
}

/** The trimmed value, or null — an emptied field clears the column rather than
 * storing "". */
function trimmedOrNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * The check-in/check-out pair, or `undefined` when the pair is not usable —
 * which is the same condition that disables Save.
 *
 * A one-date reservation is legal (a dinner has a check-in and no check-out);
 * a check-OUT with no check-in is not a stay, and a backwards pair is not one
 * either.
 */
function reservationDates(
  d: ReservationDraft,
): { checkIn: IsoDate | null; checkOut: IsoDate | null } | undefined {
  const hasIn = d.checkIn !== "";
  const hasOut = d.checkOut !== "";
  if (!hasIn && !hasOut) return { checkIn: null, checkOut: null };
  if (!hasIn) return undefined;
  if (!isoDate.safeParse(d.checkIn).success) return undefined;
  if (!hasOut) return { checkIn: d.checkIn, checkOut: null };
  // Both ends present: the same "counts both ends, null when backwards" rule
  // the trip and stop ranges use.
  if (tripDayCount(d.checkIn, d.checkOut) === null) return undefined;
  return { checkIn: d.checkIn, checkOut: d.checkOut };
}

/**
 * The `POST /api/reservations` body, or `null` while the form is not
 * submittable — the same `null` the Save button is disabled on, so there is one
 * rule, not two. `rating`/`notes` start empty: a brand-new reservation has no
 * memory on it yet.
 */
export function reservationDraftInput(
  stopId: string,
  d: ReservationDraft,
): ReservationCreateInput | null {
  const name = d.name.trim();
  if (name === "") return null;
  const cost = reservationCost(d.cost);
  if (cost === undefined) return null;
  const dates = reservationDates(d);
  if (dates === undefined) return null;
  return {
    stopId,
    type: d.type,
    name,
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    confirmationNumber: trimmedOrNull(d.confirmationNumber),
    cost,
    rating: null,
    notes: null,
  };
}

/** The reservation, as the edit form's opening state. */
export function reservationDraft(r: Reservation): ReservationDraft {
  return {
    type: r.type,
    name: r.name,
    checkIn: text(r.checkIn),
    checkOut: text(r.checkOut),
    confirmationNumber: text(r.confirmationNumber),
    cost: r.cost === null ? "" : String(r.cost),
  };
}

/**
 * The `PATCH /api/reservations/:id` body: the keys that actually differ from
 * the row on screen, and nothing else. `null` while the draft is not
 * submittable, so a half-typed date can never ride along with a good name.
 */
export function reservationDraftPatch(
  r: Reservation,
  d: ReservationDraft,
): ReservationPatchInput | null {
  const next = reservationDraftInput(r.stopId, d);
  if (next === null) return null;
  const patch: ReservationPatchInput = {};
  if (next.type !== r.type) patch.type = next.type;
  if (next.name !== r.name) patch.name = next.name;
  if (next.checkIn !== r.checkIn) patch.checkIn = next.checkIn;
  if (next.checkOut !== r.checkOut) patch.checkOut = next.checkOut;
  if (next.confirmationNumber !== r.confirmationNumber) {
    patch.confirmationNumber = next.confirmationNumber;
  }
  if (next.cost !== r.cost) patch.cost = next.cost;
  return patch;
}

/**
 * What "Undo" re-POSTs after a reservation delete. The row comes back with a
 * NEW id — the DELETE committed — so every column has to travel in the body,
 * the rating and the note included.
 */
export function reservationRestoreInput(r: Reservation): ReservationCreateInput {
  return {
    stopId: r.stopId,
    type: r.type,
    name: r.name,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    confirmationNumber: r.confirmationNumber,
    cost: r.cost,
    rating: r.rating,
    notes: r.notes,
  };
}

// ── the idea form ──────────────────────────────────────────────────────────

/**
 * "Add idea" is one field, plus an OPTIONAL place (#60). An idea is a maybe —
 * it earns its place with a title and nothing else, so Save is disabled on an
 * empty title only: a place without a title is not an idea. When nothing was
 * picked this still returns `place: null`, exactly as it always has.
 */
export function ideaDraftInput(
  stopId: string,
  title: string,
  picked: PickedPlace | null = null,
): IdeaCreateInput | null {
  const t = title.trim();
  if (t === "") return null;
  return {
    stopId,
    title: t,
    status: "idea",
    place: ideaPlace(picked),
    rating: null,
    notes: null,
  };
}

/** The picked place an idea stores, or null — the free-text escape row counts,
 * which is why a coordless idea is legal for the same reason a coordless save
 * is. */
export function ideaPlace(picked: PickedPlace | null): Place | null {
  return picked && picked.name.trim() !== "" ? placeOf(picked) : null;
}

/** The idea's place columns, as `updateIdeaFields` names them. Nullable all
 * the way down: an idea is the grammar's *maybe*, so a coordless name is a
 * legal row and so is no place at all. */
export interface IdeaPlaceColumns {
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
}

/**
 * The idea PATCH's flattening — the mirror of `stopPatchColumns`. `ideas` has
 * no `place` column and `updateIdeaFields` spreads its patch straight into
 * `db.update(ideas).set()`, so the route calls this between the two or the
 * PATCH is a SQL error on the field this issue exists to write.
 *
 * ABSENT IS NOT NULL, and that distinction is the whole function. Zod's
 * `.optional()` leaves an unsent key absent, so `patch.place === undefined` is
 * "the caller said nothing about the place — leave all four columns alone".
 * Only an EXPLICIT `null` clears them. Mapping unconditionally would erase a
 * located idea's coordinates on every status cycle, rating and note save,
 * because each of those is a single-field patch.
 */
export function ideaPatchColumns(
  patch: IdeaPatchInput,
): Omit<IdeaPatchInput, "place"> & Partial<IdeaPlaceColumns> {
  const { place: picked, ...rest } = patch;
  if (picked === undefined) return rest;
  return {
    ...rest,
    placeName: picked?.name ?? null,
    lat: picked?.lat ?? null,
    lng: picked?.lng ?? null,
    googlePlaceId: picked?.googlePlaceId ?? null,
  };
}

/** What "Undo" re-POSTs after an idea delete — the whole row, so a promoted-to
 * -"planned" idea does not come back as a fresh maybe. */
export function ideaRestoreInput(i: Idea): IdeaCreateInput {
  return {
    stopId: i.stopId,
    title: i.title,
    status: i.status,
    place: i.place,
    rating: i.rating,
    notes: i.notes,
  };
}
