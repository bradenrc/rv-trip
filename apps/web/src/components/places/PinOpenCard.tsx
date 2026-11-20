import Link from "next/link";
import type { SavedPlace } from "@rv-trip/core";
import { CategoryTile, Stars } from "@rv-trip/ui";

/**
 * A saved pin's card with "Open" (#197 · #196, docs/design/197 §5 `.mcard`):
 * the tile, the name, "Been there · Bellingham", the stars when rated, and
 * Open → /places/[id], the Place view. Two clicks: pin, then Open.
 *
 * It floats over a map that has no card of its own — the Places map panel and
 * the Journal map. /map's rail already has a selected card, so Open goes on
 * that card instead (`MapOverview` `SelectedPlace`).
 */
export function PinOpenCard({ save, className = "" }: { save: SavedPlace; className?: string }) {
  const shelf = save.status === "been" ? "Been there" : "Want to go";
  const where = save.area?.name ?? save.region;
  return (
    <div
      className={`flex items-center gap-2 rounded-rv-card border border-rv-border-hi bg-rv-surface px-2.5 py-[9px] shadow-rv-lg ${className}`}
    >
      <CategoryTile type={save.type} size="sm" />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[12.5px] text-rv-ink">{save.place.name}</b>
        <span className="block truncate font-mono text-[9.5px] text-rv-ink-faded">
          {[shelf, where].filter(Boolean).join(" · ")}
        </span>
      </div>
      {save.rating != null && save.rating > 0 && <Stars value={save.rating} size={10} />}
      <Link
        href={`/places/${save.id}`}
        className="whitespace-nowrap text-[11.5px] font-bold text-rv-accent no-underline"
      >
        Open
      </Link>
    </div>
  );
}
