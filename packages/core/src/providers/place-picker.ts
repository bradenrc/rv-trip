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
