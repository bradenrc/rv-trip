import type { DrillDoorId } from "@rv-trip/core";

/**
 * The doors out (#82). Since #197 · #193 the door table itself — `drillDoors`,
 * `drillGroupLabel` and their types — lives in @rv-trip/core
 * (packages/core/src/providers/drill.ts), so the phone draws the same doors.
 * It is re-exported here unchanged, so every web import from @rv-trip/ui keeps
 * compiling. What stays here is web-only: the favicon marks the DrillRow wears.
 */
export {
  drillDoors,
  drillGroupLabel,
  type DrillDoor,
  type DrillDoorId,
  type DrillGroup,
  type DrillInput,
} from "@rv-trip/core";

/**
 * The ten brand marks, and the domain each one's favicon is fetched from at
 * BUILD time (`pnpm marks:drill` → `apps/web/public/drill/<id>.png`). Never a
 * runtime hotlink: walks and CI stay network-independent, and a door whose PNG
 * is missing still renders its 30px chip and still navigates.
 *
 * Ten marks for twelve doors: the Google trio share one mark and are told apart
 * by the badge, which is the whole of Q1 → B.
 */
export const DRILL_MARKS: { id: string; domain: string }[] = [
  { id: "google", domain: "google.com" },
  { id: "reddit", domain: "reddit.com" },
  { id: "instagram", domain: "instagram.com" },
  { id: "facebook", domain: "facebook.com" },
  { id: "thedyrt", domain: "thedyrt.com" },
  { id: "campendium", domain: "campendium.com" },
  { id: "youtube", domain: "youtube.com" },
  { id: "yelp", domain: "yelp.com" },
  { id: "alltrails", domain: "alltrails.com" },
  { id: "tripadvisor", domain: "tripadvisor.com" },
];

/** Which mark a door wears. The Google trio all wear Google's. */
export function drillMarkId(id: DrillDoorId): string {
  switch (id) {
    case "google":
    case "google-ai":
    case "google-img":
      return "google";
    case "dyrt":
      return "thedyrt";
    default:
      return id;
  }
}
