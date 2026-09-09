import { z } from "zod";
import type { PlaceSummary, PlacesProvider } from "./index";

/**
 * Locate — the bounded coordinate backfill of docs/design/41 §6.
 *
 * A stop or a saved place can exist with no `lat/lng` (both columns are
 * nullable). The map keeps those rows as `UnmappedRow`s — visible, listed, and
 * counted by the dashed "N unmapped" chip — rather than dropping them. Locate
 * is the user-pressed repair: one press, one bounded batch, at most
 * `LOCATE_MAX_ROWS` geocodes, and the count shrinking is the feedback.
 *
 * IDS ONLY ON THE WAY IN. The caller sends `{ kind, id }`; the name and region
 * that reach Google are re-read from the database under the owner's scope by
 * the `LocateStore`. A client can therefore never make us geocode — or write —
 * a row it does not own, and never has to widen `UnmappedRow`
 * (apps/web/src/components/map/pins.ts, which carries only id/name/layer).
 *
 * Same split as places-search.ts: the whole decision tree is here, pure and
 * covered, and `apps/web/src/app/api/places/locate/route.ts` is the adapter
 * that parses the body, builds the db-backed store and returns the answer. The
 * ops escape hatch `pnpm backfill:places` calls this same function with the
 * same store over every coordless row, unbounded by choice because a human
 * typed it.
 */

/** One press geocodes at most this many rows — a hard ceiling on the Google
 * bill per click, which is exactly what the read-repair alternative could not
 * promise (§6 "Bounds"). */
export const LOCATE_MAX_ROWS = 25;

/**
 * Which table the id names. The client derives this from the row's map layer —
 * `layer === "saved" ? "place" : "stop"` — since the three trip layers are all
 * stops.
 */
export const locateRowKind = z.enum(["place", "stop"]);
export type LocateRowKind = z.infer<typeof locateRowKind>;

export const locateRowSchema = z.object({
  kind: locateRowKind,
  id: z.string().uuid(),
});
export type LocateRow = z.infer<typeof locateRowSchema>;

/**
 * POST /api/places/locate. A batch above the cap is REJECTED rather than
 * silently truncated: the button slices to the cap itself, so an oversized body
 * is a caller bug, and quietly geocoding the first 25 of 40 would report
 * "located 25 of 40" for a batch that never looked at 15 of them.
 */
export const locateRequestSchema = z.object({
  rows: z.array(locateRowSchema).min(1).max(LOCATE_MAX_ROWS),
});
export type LocateRequest = z.infer<typeof locateRequestSchema>;

/** A row as the DATABASE describes it — the only source of the search text. */
export interface LocateTarget extends LocateRow {
  name: string;
  /** Saved places carry one; a stop has no region column, so it is null. */
  region: string | null;
}

/** One row that now has a pin. */
export interface LocatedRow {
  id: string;
  lat: number;
  lng: number;
}

/** The §3 payload, exactly: two counts and the coordinates that changed. The
 * caller already knows the names it sent, so the rows that stayed unmapped are
 * the ids it sent minus these — no name travels back either. */
export interface LocateResponse {
  located: number;
  stillUnmapped: number;
  results: LocatedRow[];
}

/**
 * The owner-scoped seam onto the database. `load` returns only rows this owner
 * owns AND that are still coordless, so an unknown id, another tenant's id and
 * an already-mapped row all resolve the same way: nothing comes back, nothing
 * is billed, and the row is counted as still unmapped.
 */
export interface LocateStore {
  load(rows: LocateRow[]): Promise<LocateTarget[]>;
  /** Writes lat/lng (and the id Google matched) onto the row. False when the
   * row vanished between the read and the write. */
  saveCoords(target: LocateTarget, found: PlaceSummary): Promise<boolean>;
}

export interface LocatePlacesInput {
  rows: LocateRow[];
  provider: PlacesProvider;
  store: LocateStore;
}

/** What we ask Google: the name, and the region when the row has one. */
export function locateQuery(target: { name: string; region: string | null }): string {
  return [target.name, target.region].filter(Boolean).join(", ");
}

const rowKey = (row: LocateRow) => `${row.kind}:${row.id}`;

/** First-seen order, one entry per row — a repeated id is one billed lookup. */
export function dedupeLocateRows(rows: LocateRow[]): LocateRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(rowKey(r)) ? false : (seen.add(rowKey(r)), true)));
}

/**
 * The first answer that actually carries coordinates. A provider failure is
 * swallowed HERE and nowhere else: a row Google cannot place is a fact about
 * that row, not an outage for the batch, so the remaining rows still get their
 * chance and the caller gets a count rather than a 500.
 */
async function geocode(provider: PlacesProvider, target: LocateTarget): Promise<PlaceSummary | null> {
  let answers: PlaceSummary[];
  try {
    answers = await provider.search(locateQuery(target));
  } catch {
    return null;
  }
  return answers.find((a) => a.location != null) ?? null;
}

/**
 * One bounded batch. Serial by design: 25 sequential lookups keep the vendor
 * spike (and the bill) legible, and the button is disabled for the duration.
 */
export async function locatePlaces(input: LocatePlacesInput): Promise<LocateResponse> {
  const rows = dedupeLocateRows(input.rows);
  if (rows.length === 0) return { located: 0, stillUnmapped: 0, results: [] };

  const targets = await input.store.load(rows);
  const byKey = new Map(targets.map((t) => [rowKey(t), t]));
  const results: LocatedRow[] = [];

  for (const row of rows) {
    const target = byKey.get(rowKey(row));
    if (!target) continue;
    const found = await geocode(input.provider, target);
    if (!found?.location) continue;
    if (!(await input.store.saveCoords(target, found))) continue;
    results.push({ id: target.id, lat: found.location.lat, lng: found.location.lng });
  }

  return { located: results.length, stillUnmapped: rows.length - results.length, results };
}

/** "A", "A and B", "A, B and C", then "A, B and 2 more". */
function nameList(names: string[]): string {
  if (names.length === 1) return names[0]!;
  const head = names.slice(0, names.length <= 3 ? -1 : 2);
  const tail = names.length <= 3 ? names[names.length - 1]! : `${names.length - 2} more`;
  return `${head.join(", ")} and ${tail}`;
}

/**
 * The completion toast of §6 state 4, verbatim: "Located 1 of 2. Forest Road 25
 * pullout still has no coordinates." A row Google cannot place is reported by
 * name because that is the only way the user knows which one to fix by hand —
 * it stays in the library, stays in the count, and Locate can be pressed again.
 */
export function locateToastMessage(located: number, unlocated: string[]): string {
  const head = `Located ${located} of ${located + unlocated.length}.`;
  if (unlocated.length === 0) return head;
  const verb = unlocated.length === 1 ? "still has" : "still have";
  return `${head} ${nameList(unlocated)} ${verb} no coordinates.`;
}
