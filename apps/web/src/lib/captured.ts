import type { Idea, IdeaPatchInput, SavedPlace } from "@rv-trip/core";

/**
 * #176 i3 · what `window.dispatchEvent(new CustomEvent("rv:captured", { detail }))`
 * carries after the web capture sheet writes (docs/design/176 §4). The page
 * under the sheet holds its data in client state (`TripPlanner`'s
 * `useState(initialTrip)`, `PlacesWorkspace`'s list), so `router.refresh()`
 * would not re-render it: each listener splices the change in itself.
 *
 * - `idea` — a "Been here" POST created a done idea (`destinationId` null is a
 *   shelf idea);
 * - `idea-patch` — a "Been here" checked off a matching open idea, or its Undo
 *   put the before-state back;
 * - `idea-removed` — the Undo of a created idea (vet MED: the page must drop
 *   the row it spliced in);
 * - `place` — a library save (Want to go / Been there).
 */
export type CapturedDetail =
  | { kind: "idea"; tripId: string; idea: Idea }
  | { kind: "idea-patch"; tripId: string; id: string; patch: IdeaPatchInput }
  | { kind: "idea-removed"; tripId: string; id: string; destinationId: string | null }
  | { kind: "place"; place: SavedPlace };
