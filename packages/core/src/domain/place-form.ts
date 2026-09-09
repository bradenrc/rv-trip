import type { PickedPlace } from "../providers/place-picker";
import type {
  ReservationType,
  SavedPlace,
  SavedPlaceCreate,
  SavedPlacePatch,
  SavedPlaceStatus,
} from "./types";

/**
 * The two sheets of docs/design/41 §5, as data.
 *
 * "Save a place" (also the ⋯ menu's *Edit place*) and "Been there…" are drawn
 * in `apps/web/src/components/places/`, which has no test runner. So every
 * decision they make lives here instead — what a picked place seeds, what the
 * flat wire body looks like, what graduation clears — and the JSX is left with
 * inputs and handlers. Same split as `providers/place-picker.ts` and its
 * component.
 *
 * Nothing here imports React or `@rv-trip/ui`: the sheet resolves its category
 * icons and colors through `categoryMeta` at the component, and this module
 * only names which five `ReservationType`s that row offers.
 */

/** One representative type per category, in the order §5 draws the row:
 * Stay · Eat · Do · Travel · Other. The sheet maps each through `categoryMeta`
 * so it never defines an icon, a label or a color of its own. */
export const SAVE_SHEET_TYPES = [
  "campground",
  "dining",
  "activity",
  "transport",
  "other",
] as const satisfies readonly ReservationType[];

/** The save/edit sheet's fields. `picked` is the PlacePicker's value; the rest
 * are the plain text inputs, held as strings because that is what an input
 * gives you — the blank→null translation happens on the way to the wire. */
export interface SavePlaceForm {
  picked: PickedPlace | null;
  type: ReservationType;
  region: string;
  source: string;
  note: string;
  /** Which shelf the row belongs to. New saves land on "want" (§5's
   * "saves to · want"); an edited row keeps whatever shelf it is on. */
  status: SavedPlaceStatus;
}

/** The graduate sheet's fields. `rating` is 0 while unrated — `Stars`' own
 * empty value — and becomes null on the wire. */
export interface GraduateForm {
  rating: number;
  tripId: string;
  note: string;
}

const blank = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** Google formats an address with the country last; it is never the region. */
const COUNTRY = /^(usa|united states|united states of america)$/i;

/** A US-style postal code trailing the state ("WA 98331" → "WA"). */
const TRAILING_ZIP = /\s+\d{5}(-\d{4})?$/;

/**
 * The Region line §5 seeds "from the address, editable": the locality and the
 * state, i.e. the last two comma-parts of the formatted address with the
 * country and the ZIP dropped. It is a display string, never geocoded, and the
 * user can overwrite it — so a plainly-wrong guess costs a keystroke, and an
 * address with an unusual shape simply seeds something the user retypes.
 */
export function regionFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "" && !COUNTRY.test(p));
  if (parts.length === 0) return null;
  const tail = parts.slice(-2).map((p) => p.replace(TRAILING_ZIP, "").trim());
  return tail.join(", ");
}

export function emptySavePlaceForm(): SavePlaceForm {
  return { picked: null, type: "other", region: "", source: "", note: "", status: "want" };
}

/**
 * The PlacePicker's `onChange`. Choosing a place seeds the Region from its
 * address, but only while the field is untouched — a typed region is the
 * user's answer and outranks Google's.
 *
 * The category is deliberately NOT defaulted from the place: neither
 * `PlaceSummary` nor `PickedPlace` carries Google's `types`, so there is
 * nothing to map onto the five categories without widening the API this epic
 * says it does not widen. The row opens on Other and the user picks. See
 * docs/design/41/dev-notes.md.
 */
export function pickPlace(form: SavePlaceForm, picked: PickedPlace | null): SavePlaceForm {
  if (!picked) return { ...form, picked: null };
  const seeded = form.region.trim() === "" ? (regionFromAddress(picked.address) ?? "") : form.region;
  return { ...form, picked, region: seeded };
}

/** Seed the sheet from a library row — the ⋯ menu's *Edit place*. */
export function savePlaceFormFromSaved(p: SavedPlace): SavePlaceForm {
  return {
    picked: {
      name: p.place.name,
      lat: p.place.lat,
      lng: p.place.lng,
      googlePlaceId: p.place.googlePlaceId,
      // Google's address and rating are search-time display only and are never
      // persisted, so a row read back has neither.
      address: null,
      rating: null,
    },
    type: p.type,
    region: p.region ?? "",
    source: p.source ?? "",
    note: p.note ?? "",
    status: p.status,
  };
}

/**
 * The flat `POST /api/places` body (§3). Null until a place is chosen — the
 * picker's free-text escape row counts, which is why a coordless save is legal.
 */
export function savePlaceBody(form: SavePlaceForm): SavedPlaceCreate | null {
  const picked = form.picked;
  if (!picked || picked.name.trim() === "") return null;
  return {
    name: picked.name.trim(),
    region: blank(form.region),
    lat: picked.lat,
    lng: picked.lng,
    googlePlaceId: picked.googlePlaceId,
    type: form.type,
    status: form.status,
    source: blank(form.source),
    note: blank(form.note),
    rating: null,
    tripId: null,
  };
}

/**
 * The same sheet as a `PATCH /api/places/:id` body. It names only what the
 * sheet can edit: `status`, `rating` and `tripId` are the graduate sheet's, and
 * an absent key is a column the patch leaves alone.
 */
export function editPlacePatch(form: SavePlaceForm): SavedPlacePatch | null {
  const picked = form.picked;
  if (!picked || picked.name.trim() === "") return null;
  return {
    name: picked.name.trim(),
    region: blank(form.region),
    lat: picked.lat,
    lng: picked.lng,
    googlePlaceId: picked.googlePlaceId,
    type: form.type,
    source: blank(form.source),
    note: blank(form.note),
  };
}

/** Seed the graduate sheet: unrated, no trip yet, the queue note carried over. */
export function graduateFormFromSaved(p: SavedPlace): GraduateForm {
  return { rating: p.rating ?? 0, tripId: p.tripId ?? "", note: p.note ?? "" };
}

/**
 * Graduation, want → been, on the SAME row (§5): the rating and the trip
 * replace "who told you". `source: null` is sent explicitly as well as being
 * enforced server-side by `normalizeSavedPlacePatch`.
 */
export function graduatePatch(form: GraduateForm): SavedPlacePatch {
  return {
    status: "been",
    rating: form.rating > 0 ? form.rating : null,
    tripId: blank(form.tripId),
    note: blank(form.note),
    source: null,
  };
}

/**
 * The local echo of a successful PATCH: the same row with the patch applied,
 * in the READ shape (nested `place`, joined `tripName`).
 *
 * /places is a force-dynamic server component feeding a client island, so
 * after a write the island updates its own list rather than re-rendering the
 * route — the same shape TripPlanner already uses. This function is why that
 * echo cannot drift from the server: it applies exactly what the wire applies,
 * including `normalizeSavedPlacePatch`'s rule that graduation clears `source`.
 * An absent key leaves its column alone; an explicit `null` blanks it.
 */
export function applySavedPlacePatch(
  p: SavedPlace,
  patch: SavedPlacePatch,
  tripName: string | null = null,
): SavedPlace {
  const keep = <T>(v: T | undefined, current: T): T => (v === undefined ? current : v);
  const status = keep(patch.status, p.status);
  return {
    ...p,
    place: {
      name: keep(patch.name, p.place.name),
      lat: keep(patch.lat, p.place.lat),
      lng: keep(patch.lng, p.place.lng),
      googlePlaceId: keep(patch.googlePlaceId, p.place.googlePlaceId),
    },
    region: keep(patch.region, p.region),
    type: keep(patch.type, p.type),
    status,
    note: keep(patch.note, p.note),
    // The server clears "who told you" on graduation whatever the body said.
    source: status === "been" ? null : keep(patch.source, p.source),
    rating: keep(patch.rating, p.rating),
    tripId: keep(patch.tripId, p.tripId),
    tripName: patch.tripId === undefined ? p.tripName : tripName,
  };
}

/**
 * A library row flattened back into a create body — what the undo toast
 * re-posts after a delete. DELETE is a hard delete (§3), so undo is a re-save:
 * the row comes back with the same content under a new id. `tripName` is joined
 * on read and never written.
 */
export function savedPlaceToCreate(p: SavedPlace): SavedPlaceCreate {
  return {
    name: p.place.name,
    region: p.region,
    lat: p.place.lat,
    lng: p.place.lng,
    googlePlaceId: p.place.googlePlaceId,
    type: p.type,
    status: p.status,
    note: p.note,
    source: p.source,
    rating: p.rating,
    tripId: p.tripId,
  };
}
