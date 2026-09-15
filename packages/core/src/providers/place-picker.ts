import type { PlaceSummary } from "./index";
import type { PlacesEnvelope } from "./places-search";

/**
 * The PlacePicker's view-model — docs/design/41 §4, states 1-7.
 *
 * The client half of the wire `places-search.ts` defines: that module decides
 * what the route answers, this one decides what the picker draws when the
 * answer lands. It is pure — no React, no `fetch`, no timers — for the same
 * reason the envelope is: `packages/core` is the only workspace with a test
 * runner, so a decision that lives here is a decision that is actually covered.
 * `apps/web/src/components/places/PlacePicker.tsx` is the JSX over it.
 *
 * The one rule the whole design turns on: **the escape row is the last row of
 * every state that shows a list** — results, no-match and degraded alike. That
 * is why there is no empty state to draw, and why saving is never blocked.
 */

/**
 * What the picker hands back. The three "where is it" fields are null together
 * when the free-text escape was taken; `address` and `rating` are Google's, for
 * seeding a Region field and for display — neither is ever persisted as-is.
 */
export interface PickedPlace {
  name: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  address: string | null;
  rating: number | null;
}

/** How long the box sits still before it becomes a billed question (§4 state 2). */
export const PICKER_DEBOUNCE_MS = 250;

export const PICKER_PLACEHOLDER = "Search a campground, diner, trailhead…";

/** One line for all three degraded reasons: the user's next move is the same. */
export const PICKER_DEGRADED_MESSAGE =
  "Place search is unavailable right now — you can still type a name and save.";

export const PICKER_ESCAPE_BLURB = "No coordinates — add them later from the map";

export const PICKED_COORDLESS_LABEL = "No coordinates — won’t appear on the map yet";

/** `Use “kalaloch” as a plain name` — the query read back exactly as typed. */
export function escapeRowLabel(query: string): string {
  return `Use “${query.trim()}” as a plain name`;
}

export function pickedFromSummary(summary: PlaceSummary): PickedPlace {
  return {
    name: summary.name,
    lat: summary.location?.lat ?? null,
    lng: summary.location?.lng ?? null,
    googlePlaceId: summary.googlePlaceId,
    address: summary.address,
    rating: summary.rating,
  };
}

export function pickedFromFreeText(query: string): PickedPlace {
  return {
    name: query.trim(),
    lat: null,
    lng: null,
    googlePlaceId: null,
    address: null,
    rating: null,
  };
}

/** How many leading characters of a place id the picked chip shows. */
const ID_PREFIX = 8;

/** U+2212 MINUS SIGN, not a hyphen — the design's own coordinate typography. */
function coord(n: number): string {
  const fixed = Math.abs(n).toFixed(4);
  return n < 0 ? `−${fixed}` : fixed;
}

/**
 * `47.6118, −124.3762 · ChIJvT2R…`, or the coordless line. Half a coordinate is
 * no coordinate: a lone latitude cannot be drawn, and rounding it into a pin
 * would be a fabricated location.
 */
export function pickedCoordLabel(picked: PickedPlace): string {
  if (picked.lat === null || picked.lng === null) return PICKED_COORDLESS_LABEL;
  const pair = `${coord(picked.lat)}, ${coord(picked.lng)}`;
  if (!picked.googlePlaceId) return pair;
  return `${pair} · ${picked.googlePlaceId.slice(0, ID_PREFIX)}…`;
}

/**
 * A row of the open list. Every row carries the exact `PickedPlace` choosing it
 * emits, so "what does clicking this do" is data rather than a branch in the
 * click handler.
 */
export interface PickerRow {
  kind: "result" | "escape";
  /** The bold line — a place name, or the "Use … as a plain name" prompt. */
  name: string;
  /** The mono second line — Google's address, or the coordless blurb. */
  detail: string | null;
  /** Google's rating, for the trailing `★ 4.4`. Never ours. */
  rating: number | null;
  picked: PickedPlace;
}

export type PickerView =
  | { state: "idle"; placeholder: string }
  | { state: "typing"; status: string }
  | {
      state: "list";
      /** `2 results` — null when nothing counted anything (degraded). */
      status: string | null;
      rows: PickerRow[];
      /** Index into `rows`; -1 is "nothing highlighted". */
      highlight: number;
      degradedMessage: string | null;
    }
  | { state: "picked"; picked: PickedPlace; coordLabel: string; mapped: boolean };

export interface PickerViewInput {
  value: PickedPlace | null;
  /** The raw text in the box, untrimmed. */
  query: string;
  /** The envelope that came back for `query`, or null when none has yet. */
  envelope: PlacesEnvelope | null;
  /** True while the debounce timer or the request for `query` is outstanding. */
  pending: boolean;
  placeholder?: string;
  /** Where the keyboard is; omitted means "wherever a fresh list would start". */
  highlight?: number;
}

/**
 * Where the highlight sits when an answer first lands.
 *
 * A real answer (results, or an honest empty one) highlights its first row, so
 * Enter commits the obvious thing. A degraded answer highlights nothing: we did
 * not look, so the picker does not pretend to have offered anything. Enter is
 * still an escape hatch in the component — it falls through to the escape row,
 * which is always last — but the row is not lit as if it were a search result.
 */
export function initialHighlight(envelope: PlacesEnvelope): number {
  return envelope.degraded ? -1 : 0;
}

/** Arrow-key movement with wrap-around, starting from "nothing highlighted". */
export function moveHighlight(current: number, rowCount: number, delta: 1 | -1): number {
  if (rowCount <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : rowCount - 1;
  return (current + delta + rowCount) % rowCount;
}

function escapeRow(query: string): PickerRow {
  return {
    kind: "escape",
    name: escapeRowLabel(query),
    detail: PICKER_ESCAPE_BLURB,
    rating: null,
    picked: pickedFromFreeText(query),
  };
}

function resultRow(summary: PlaceSummary): PickerRow {
  return {
    kind: "result",
    name: summary.name,
    detail: summary.address,
    rating: summary.rating,
    picked: pickedFromSummary(summary),
  };
}

/**
 * The seven states, in the order the design draws them. Precedence matters:
 * a picked value outranks whatever is still in the box (§4 states 6-7 replace
 * the field entirely), and a request still in flight outranks the previous
 * query's stale envelope.
 */
export function pickerView(input: PickerViewInput): PickerView {
  const { value, query, envelope, pending } = input;

  if (value) {
    return {
      state: "picked",
      picked: value,
      coordLabel: pickedCoordLabel(value),
      mapped: value.lat !== null && value.lng !== null,
    };
  }

  if (query.trim() === "") {
    return { state: "idle", placeholder: input.placeholder ?? PICKER_PLACEHOLDER };
  }

  if (pending || !envelope) {
    return { state: "typing", status: `waiting · ${PICKER_DEBOUNCE_MS} ms` };
  }

  const rows = [...envelope.results.map(resultRow), escapeRow(query)];
  const count = envelope.results.length;
  return {
    state: "list",
    // Degraded counts nothing, so it says nothing — "0 results" would claim a
    // search that never happened.
    status: envelope.degraded ? null : `${count} ${count === 1 ? "result" : "results"}`,
    rows,
    highlight: input.highlight ?? initialHighlight(envelope),
    degradedMessage: envelope.degraded ? PICKER_DEGRADED_MESSAGE : null,
  };
}

/**
 * A stored `Place` as the picker's controlled VALUE — how "Change place…" and
 * the home-base fields open on what is already there (§4 state 6/7). Google's
 * `address` and `rating` are search-time display only and are never persisted,
 * so a row read back has neither; the inverse of `pickedFromSummary`.
 */
export function pickedFromPlace(place: {
  name: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
} | null): PickedPlace | null {
  if (!place) return null;
  return {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    googlePlaceId: place.googlePlaceId,
    address: null,
    rating: null,
  };
}

/** A search bias with the name that earned it, so the picker can say where it
 * is looking rather than silently ranking. */
export interface NearPlace {
  name: string;
  lat: number;
  lng: number;
}

/**
 * The search bias a picker mounted on a stop row gets: the stop above it in the
 * leg, then the trip's home base when there is nothing above it. Null when
 * neither has a FULL pair — half a coordinate is no coordinate here either, and
 * the search still runs, just unranked.
 */
export function nearOf(
  ...candidates: ({ name: string; lat: number | null; lng: number | null } | null | undefined)[]
): NearPlace | null {
  for (const c of candidates) {
    if (c && c.lat !== null && c.lng !== null) return { name: c.name, lat: c.lat, lng: c.lng };
  }
  return null;
}

/**
 * `near · Newport, OR · 44.6083, −124.0640` — the ONE new user-facing string
 * the inline mount adds. The `near` prop has always existed and has never been
 * visible; this is it, in the picker's own coordinate typography (U+2212).
 */
export function nearLabel(near: NearPlace): string {
  return `near · ${near.name} · ${coord(near.lat)}, ${coord(near.lng)}`;
}

// ── the open list's frame (#80 walk) ───────────────────────────────────────

/**
 * The open list used to be an `absolute` child of the field's `relative`
 * wrapper. That is a stacking-context trap: `z-10` only ever wins inside
 * whatever context the wrapper happens to sit in, so on the trip page — where
 * the picker opens inside the add-idea card and the Gantt's own `sticky z-10`
 * row labels come LATER in the document — every row below the card's edge was
 * painted over by the timeline. The fix is to portal the list to `document.body`,
 * where no ancestor can trap it, which means the component now has to say where
 * the list goes. That arithmetic is here, where it can be tested: the component
 * only measures the field and hands the numbers over.
 */

/** The breathing room kept between the bottom of the list and the viewport. */
export const PICKER_LIST_GUTTER_PX = 12;

/**
 * The shortest list worth drawing. Below this a cap is worse than an overflow —
 * the field is so close to the bottom edge that capping would leave a sliver
 * with no room even for the escape row, so the list is allowed to run past the
 * gutter and scroll instead.
 */
export const PICKER_LIST_MIN_PX = 132;

/** The field box's viewport rect — the three numbers of `getBoundingClientRect`
 * the list's frame is derived from. */
export interface PickerAnchor {
  left: number;
  bottom: number;
  width: number;
}

/** A `position: fixed` frame, in viewport pixels. */
export interface PickerListFrame {
  left: number;
  top: number;
  width: number;
  /** The list scrolls inside this rather than running off the screen. */
  maxHeight: number;
}

/**
 * Where the portaled list sits: flush under the field, exactly as wide, capped
 * to what is left of the viewport. The seam matters — the field draws
 * `rounded-t` + the list `border-t-0`, so a gap of even a pixel would show as a
 * broken border — which is why the list never flips above: it stays welded to
 * the box and scrolls internally instead.
 */
export function pickerListFrame(anchor: PickerAnchor, viewportHeight: number): PickerListFrame {
  const room = viewportHeight - anchor.bottom - PICKER_LIST_GUTTER_PX;
  return {
    left: anchor.left,
    top: anchor.bottom,
    width: anchor.width,
    maxHeight: Math.max(PICKER_LIST_MIN_PX, room),
  };
}
