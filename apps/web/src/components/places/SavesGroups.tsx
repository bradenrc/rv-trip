import { Fragment, type ReactNode } from "react";
import { savesShelves, type SavedPlace, type SavedPlaceStatus } from "@rv-trip/core";

/** The library's card grid — the shipped PlacesLibrary grid, one per group. */
const GRID = "grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]";

/**
 * The /places grid grouped the way the phone's Saves tab groups it (#111 i4 ·
 * docs/design/111 "Web parity", Q4 B): region headers (most saves first),
 * area headers with their count, the cards newest first, and the saves
 * with no area in an Unanchored group last. The ORDER is core's
 * `savesShelves`, so the web and the phone cannot disagree about it.
 *
 * Presentational only: the library still owns the shelf, the category filter
 * and the map lens, and hands this the filtered list plus how to draw a card.
 * A region the resolver named no region for gets no header, as on the phone.
 */
export function SavesGroups({
  places,
  status,
  renderCard,
}: {
  places: SavedPlace[];
  status: SavedPlaceStatus;
  renderCard: (place: SavedPlace) => ReactNode;
}) {
  const { regions, unanchored } = savesShelves(places, status);
  return (
    <div className="flex flex-col gap-2.5">
      {regions.map((r) => (
        <Fragment key={r.region ?? "—"}>
          {r.region !== null && (
            <div
              data-shelf="region"
              className="px-0.5 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-rv-ink-faded"
            >
              {r.region}
            </div>
          )}
          {r.areas.map((d) => (
            <Fragment key={d.area.id}>
              <div className="flex items-baseline gap-2.5">
                <b data-shelf="area" className="text-[15px] text-rv-ink">
                  {d.area.name}
                </b>
                <span className="font-mono text-[11px] text-rv-ink-faded">{d.saves.length}</span>
              </div>
              <div className={GRID}>{d.saves.map(renderCard)}</div>
            </Fragment>
          ))}
        </Fragment>
      ))}
      {unanchored.length > 0 && (
        <>
          <div
            data-shelf="unanchored"
            className="px-0.5 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-rv-ink-faded"
          >
            Unanchored
          </div>
          <div className={GRID}>{unanchored.map(renderCard)}</div>
          <div className="rounded-rv-card border border-dashed border-rv-border-hi px-[9px] py-[7px] text-[11.5px] text-rv-ink-faded">
            Unanchored saves have no town within 25 mi. They still{" "}
            <b className="text-rv-ink-muted">surface on trips by distance</b>.
          </div>
        </>
      )}
    </div>
  );
}
