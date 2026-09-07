"use client";

import { useMemo, useState } from "react";
import {
  BookmarkCheck,
  CircleCheckBig,
  LayoutGrid,
  Map as MapIcon,
  MapPinned,
} from "lucide-react";
import type { ReservationType, SavedPlace, SavedPlaceStatus } from "@rv-trip/core";
import {
  categoryMeta,
  PlaceCard,
  SegmentedControl,
  ViewSwitch,
  FilterChip,
  EmptyShelf,
  type CategoryLabel,
} from "@rv-trip/ui";
import { MapMount } from "@/components/map/MapMount";
import { buildMapModel } from "@/components/map/pins";

type View = "grid" | "map";
type CatFilter = "All" | CategoryLabel;

/** The filterable categories, in the order the chips read. One representative
 * ReservationType per category so the chip pulls its icon/color from
 * categoryMeta rather than defining its own map. */
const CAT_CHIPS: { cat: CategoryLabel; type: ReservationType }[] = [
  { cat: "Stay", type: "campground" },
  { cat: "Eat", type: "dining" },
  { cat: "Do", type: "activity" },
  { cat: "Travel", type: "transport" },
];

/**
 * The Places library. Two shelves off one status field, a category filter
 * scoped to the active shelf, and a grid/map lens over the same filtered list.
 */
export function PlacesLibrary({ places }: { places: SavedPlace[] }) {
  const [status, setStatus] = useState<SavedPlaceStatus>("want");
  const [cat, setCat] = useState<CatFilter>("All");
  const [view, setView] = useState<View>("grid");

  const shelf = useMemo(() => places.filter((p) => p.status === status), [places, status]);

  // Category counts are scoped to the active shelf — the chips describe what's
  // in front of you, not the whole library.
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: shelf.length };
    for (const p of shelf) {
      const k = categoryMeta(p.type).cat;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [shelf]);

  const list = useMemo(
    () => (cat === "All" ? shelf : shelf.filter((p) => categoryMeta(p.type).cat === cat)),
    [shelf, cat],
  );

  // The map lens draws exactly `list` — the array the grid renders. It never
  // filters again; the pins ARE the list.
  const lens = useMemo(() => buildMapModel([], list), [list]);
  const hidden = shelf.length - list.length;

  const wantCount = places.filter((p) => p.status === "want").length;
  const beenCount = places.length - wantCount;

  // Switching shelves resets the filter — a category that exists on one shelf
  // may have nothing on the other, and a silent empty result reads as a bug.
  const changeStatus = (s: SavedPlaceStatus) => {
    setStatus(s);
    setCat("All");
  };

  const cards = list.map((p) => <PlaceCard key={p.id} savedPlace={p} />);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <SegmentedControl
          value={status}
          onChange={changeStatus}
          options={[
            { value: "want", label: "Want to go", Icon: BookmarkCheck, count: wantCount },
            { value: "been", label: "Been there", Icon: CircleCheckBig, count: beenCount },
          ]}
        />
        <ViewSwitch
          value={view}
          onChange={setView}
          options={[
            { value: "grid", Icon: LayoutGrid, label: "Grid" },
            { value: "map", Icon: MapIcon, label: "Map" },
          ]}
        />
      </div>

      <div className="mb-[22px] flex flex-wrap gap-2">
        <FilterChip
          label="All"
          count={counts.All ?? 0}
          active={cat === "All"}
          onClick={() => setCat("All")}
        />
        {CAT_CHIPS.map((c) => (
          <FilterChip
            key={c.cat}
            label={c.cat}
            type={c.type}
            count={counts[c.cat] ?? 0}
            active={cat === c.cat}
            onClick={() => setCat(c.cat)}
          />
        ))}
      </div>

      {view === "map" ? (
        <>
          <div className="grid items-stretch gap-4" style={{ gridTemplateColumns: "1fr 360px" }}>
            <div className="min-h-[420px]">
              <MapMount pins={lens.pins} unmappedCount={lens.unmapped.length} />
            </div>
            <div className="grid content-start gap-3">{cards}</div>
          </div>
          {hidden > 0 && (
            <p className="m-0 mt-[11px] font-mono text-[11px] text-rv-ink-faded">
              {hidden} {hidden === 1 ? "place" : "places"} hidden by the {cat} filter
            </p>
          )}
        </>
      ) : list.length > 0 ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {cards}
        </div>
      ) : status === "want" ? (
        <EmptyShelf
          Icon={BookmarkCheck}
          title="Nothing in the queue yet"
          blurb="Heard about a great campground or diner? Save it here and add it to a trip when you're ready."
        />
      ) : (
        <EmptyShelf
          Icon={MapPinned}
          title="No visited places yet"
          blurb="Places you rate on a trip show up here so you can decide what's worth a return."
        />
      )}
    </>
  );
}
