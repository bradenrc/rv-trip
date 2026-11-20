"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookmarkCheck,
  CircleCheckBig,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  MapPinOff,
  MapPinned,
} from "lucide-react";
import type {
  LatLng,
  PlacesCategory,
  ReservationType,
  SavedPlace,
  SavedPlacePatch,
  SavedPlaceStatus,
  Units,
} from "@rv-trip/core";
import {
  categoryOf,
  convertMiles,
  DEFAULT_UNITS,
  distanceUnitLabel,
  isPlacesCategory,
  nearYou,
  nearYouName,
  nearYouNothing,
  nearYouWithin,
  placesCategoryEmpty,
} from "@rv-trip/core";
import {
  DrillRow,
  PlaceCard,
  SegmentedControl,
  ViewSwitch,
  FilterChip,
  EmptyShelf,
} from "@rv-trip/ui";
import { ChangeBylinePopover } from "@/components/history/ChangeBylinePopover";
import { GoogleLine } from "@/components/places/GoogleLine";
import { PinOpenCard } from "@/components/places/PinOpenCard";
import { MapMount } from "@/components/map/MapMount";
import { buildMapModel } from "@/components/map/pins";
import { browserPosition, resolveAreaNear } from "@/lib/area-label";
import { SavesGroups } from "./SavesGroups";

type View = "grid" | "map";

/** The chosen chip, remembered in this browser (#186 i2 · q4 A) — the phone's key too. */
const CAT_KEY = "rv-places-cat";

/** The filterable categories, in the order the chips read (#186 i2 · q3 A:
 * All · Stay · Eat · Do — Travel saves show under All only). One
 * representative ReservationType per category so the chip pulls its
 * icon/color from categoryMeta rather than defining its own map. */
const CAT_CHIPS: { cat: Exclude<PlacesCategory, "All">; type: ReservationType }[] = [
  { cat: "Stay", type: "campground" },
  { cat: "Eat", type: "dining" },
  { cat: "Do", type: "activity" },
];

/** The library's grid — SavesGroups' own, for the Near you block. */
const GRID = "grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]";
/** A group header — SavesGroups' region header type, so the two read as one list. */
const GROUP_HEAD =
  "flex items-baseline gap-1.5 px-0.5 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em]";

/**
 * The Saves library (#111 i4 renamed it from Places; the URL is still
 * /places). Two shelves off one status field, a category filter scoped to the
 * active shelf, and a grid/map lens over the same filtered list — the grid
 * grouped by area under region headers (`SavesGroups`).
 *
 * #186 i2 · #182 (docs/design/186 §4): a location chip beside the shelf
 * switch, and — once the browser has a fix — a "Near you" block (core's
 * `nearYou`, within NEAR_RADIUS_MI, distances in the account's units) ahead of
 * "Everywhere else", the shipped groups. The browser is asked only on a tap;
 * if the permission is already granted, the fix is read on load.
 */
export function PlacesLibrary({
  places,
  leading,
  cardMenu,
  onPatch,
  onShelfChange,
  units = DEFAULT_UNITS,
}: {
  places: SavedPlace[];
  /** The account's display units (`unitsFromPrefs`, read by places/page.tsx). */
  units?: Units;
  /** Cards that go before the library's own — the "Been there?" suggestions of
   * §5, drawn in the same grid row the frame draws them in. They are not
   * library rows: the shelf switch, the category chips and their counts all
   * describe `places` only, and a suggestion is offered until it is accepted or
   * dismissed. Absent (not empty-stated) when there is nothing to suggest. */
  leading?: ReactNode;
  /** The ⋯ menu, rendered BESIDE each card rather than inside it — PlaceCard
   * ships two optional props and this epic gives them no siblings
   * (docs/design/41 §5). Absent when nothing is wired to it. */
  cardMenu?: (place: SavedPlace) => ReactNode;
  /** The research pad's ONE write (#82) — the note and the rating a card
   * already renders, now editable on BOTH shelves. `tripApi.updatePlace` is
   * owned one level up, in PlacesWorkspace; absent, the pad renders read-only,
   * which is today's behaviour. */
  onPatch?: (place: SavedPlace, patch: SavedPlacePatch) => void;
  /** #186 i9 (#160 · q10 A): told the active shelf whenever it switches, so
   * "Save a place" opens on the shelf you are looking at. Starts on "want". */
  onShelfChange?: (status: SavedPlaceStatus) => void;
}) {
  const [status, setStatus] = useState<SavedPlaceStatus>("want");
  const [cat, setCat] = useState<PlacesCategory>("All");
  const [view, setView] = useState<View>("grid");
  /** Which card has its research pad open — one at a time, the library's own
   * state. The card renders the pad; it never knows about the shelf. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** #186 i7 · the card ⇄ pin link of the md+ panel: hovering or clicking a
   * card selects it, and a pin selects its card. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The md+ split's grid column — where a pin looks for its card. The lens
   * below md renders its own copies, so the lookup is scoped, never by id. */
  const gridRef = useRef<HTMLDivElement>(null);
  const selectPin = useCallback((id: string) => {
    setSelectedId(id);
    gridRef.current
      ?.querySelector(`[data-save-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  /** Where the browser is — null until it says (and for good, if refused). */
  const [here, setHere] = useState<LatLng | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);

  // The remembered chip, read once after mount: the server render has no
  // storage, so reading it during render would mismatch hydration. One
  // set, on mount only — not the cascading-render case the rule guards.
  useEffect(() => {
    try {
      const v = localStorage.getItem(CAT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isPlacesCategory(v)) setCat(v);
    } catch {
      // Storage blocked: the chips start on All.
    }
  }, []);
  const pickCat = (c: PlacesCategory) => {
    setCat(c);
    try {
      localStorage.setItem(CAT_KEY, c);
    } catch {
      // Not remembered this time; the choice still applies.
    }
  };

  const locate = useCallback(async () => {
    const at = await browserPosition();
    if (at) setHere(at);
  }, []);
  // Never a prompt on load: only an already-granted permission reads the fix.
  useEffect(() => {
    let live = true;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (live && p.state === "granted") void locate();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [locate]);

  const shelf = useMemo(() => places.filter((p) => p.status === status), [places, status]);

  // Category counts are scoped to the active shelf — the chips describe what's
  // in front of you, not the whole library.
  const counts = useMemo(
    () =>
      Object.fromEntries(
        (["All", ...CAT_CHIPS.map((c) => c.cat)] as PlacesCategory[]).map((c) => [
          c,
          nearYou(places, status, null, c).total,
        ]),
      ) as Record<PlacesCategory, number>,
    [places, status],
  );

  /** Near you, then the rest grouped as shipped — one core call, both clients. */
  const split = useMemo(() => nearYou(places, status, here, cat), [places, status, here, cat]);
  const list = useMemo(
    () => (cat === "All" ? shelf : shelf.filter((p) => categoryOf(p.type).cat === cat)),
    [shelf, cat],
  );

  // The chip's name: the nearest near save's area, else the locality the
  // resolver names, else "Near you". Read off the All list so it holds still
  // while chips change.
  const areaName = useMemo(
    () => (here ? nearYouName(nearYou(places, status, here, "All").near, null) : null),
    [places, status, here],
  );
  useEffect(() => {
    if (!here || areaName !== null) return;
    let live = true;
    resolveAreaNear(here)
      .then((a) => {
        if (live) setResolved(a?.name ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [here, areaName]);
  const name = here ? (areaName ?? resolved) : null;
  const miles = (mi: number) => `${Math.round(convertMiles(mi, units))} ${distanceUnitLabel(units)}`;

  // The map lens draws exactly `list` — the array the grid renders. It never
  // filters again; the pins ARE the list.
  const lens = useMemo(() => buildMapModel([], list), [list]);
  const hidden = shelf.length - list.length;
  /** The panel's selected pin, when it is one the panel draws (#197 · #196). */
  const panelPick = lens.pins.some((p) => p.id === selectedId)
    ? (list.find((p) => p.id === selectedId) ?? null)
    : null;

  const wantCount = places.filter((p) => p.status === "want").length;
  const beenCount = places.length - wantCount;

  // Switching shelves resets the filter — a category that exists on one shelf
  // may have nothing on the other, and a silent empty result reads as a bug.
  const changeStatus = (s: SavedPlaceStatus) => {
    setStatus(s);
    onShelfChange?.(s);
    pickCat("All");
  };

  // The wrapper is the grid item, so the card still stretches to the row's
  // height (`grid` on a single child stretches it) and the menu can anchor to
  // the card's own box. `onAddToTrip` stays unpassed: the add-a-destination path it
  // needs is issue #22, in epic #40 — until then the DS button is inert by
  // design, not by omission.
  // #186 i7: the wrapper is also the panel's hover/click target, and the
  // selected one carries the ring its pin is lit for.
  const cardFor = (p: SavedPlace, distance?: string) => (
    <div
      key={p.id}
      data-save-id={p.id}
      onMouseEnter={() => setSelectedId(p.id)}
      onClick={() => setSelectedId(p.id)}
      className={`relative grid rounded-rv-card${
        selectedId === p.id ? " ring-2 ring-rv-green shadow-rv-lg" : ""
      }`}
    >
      <PlaceCard
        savedPlace={p}
        distance={distance}
        expanded={expandedId === p.id}
        onToggleExpand={() => setExpandedId((id) => (id === p.id ? null : p.id))}
        onPatch={onPatch ? (patch) => onPatch(p, patch) : undefined}
        /* A saved place's locality is its own `region` — display-only and
           nullable, and there is no fourth source: a region-less place simply
           searches on the name. */
        drill={<DrillRow name={p.place.name} locality={p.region} type={p.type} />}
        gline={<GoogleLine googlePlaceId={p.place.googlePlaceId} />}
        /* Who last rated or noted this place, and what it was before (#78). */
        byline={
          <ChangeBylinePopover
            last={p.lastChange}
            entity="save"
            entityId={p.id}
            name={p.place.name}
          />
        }
      />
      {cardMenu?.(p)}
    </div>
  );
  /** Every card but a Near you one: no distance. */
  const renderCard = (p: SavedPlace) => cardFor(p);
  // The map lens's side list stays the flat list it shipped as — the pins ARE
  // the list, and the grouping is the grid's (#111 i4).
  const cards = list.map(renderCard);

  /** The grid column: the grouped grid, or the shelf's empty state. */
  const body =
    list.length > 0 || leading ? (
      <>
        {/* The "Been there?" suggestions are not library rows, so they sit
          in their own row ahead of the groups rather than under a header. */}
        {leading && (
          <div className="mb-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
              {leading}
            </div>
          </div>
        )}
        {/* #186 i2 · q1 A: with a fix, Near you leads, nearest first. */}
        {here && list.length > 0 && (
          <div className="mb-4 flex flex-col gap-2.5">
            <div className={`${GROUP_HEAD} font-bold text-rv-ink`}>
              Near you
              <span className="ml-auto font-medium normal-case tracking-normal text-rv-ink-faded">
                {nearYouWithin(name)}
              </span>
            </div>
            {split.near.length > 0 ? (
              <div className={GRID}>{split.near.map((n) => cardFor(n.save, miles(n.mi)))}</div>
            ) : (
              <div className="rounded-rv-card border border-dashed border-rv-border-hi p-2.5 text-center text-[11.5px] text-rv-ink-muted">
                {nearYouNothing(name)}
              </div>
            )}
            {split.total > split.near.length && (
              <div className={`${GROUP_HEAD} mt-1 text-rv-ink-faded`}>Everywhere else</div>
            )}
          </div>
        )}
        {/* #111 i4 · Q4 B: the grid is grouped by area under region
          headers — core's savesShelves, the phone's Saves tab order.
          #186 i2: it draws nearYou's `rest` (all of it, with no fix). */}
        <SavesGroups places={list} status={status} shelves={split.rest} renderCard={renderCard} />
      </>
    ) : shelf.length > 0 && cat !== "All" ? (
      <div className="rounded-rv-card border border-dashed border-rv-border-hi p-2.5 text-center text-[11.5px] text-rv-ink-muted">
        {placesCategoryEmpty(cat, status)}
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
    );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            value={status}
            onChange={changeStatus}
            options={[
              { value: "want", label: "Want to go", Icon: BookmarkCheck, count: wantCount },
              { value: "been", label: "Been there", Icon: CircleCheckBig, count: beenCount },
            ]}
          />
          {here ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-rv-pill border border-rv-border-hi px-2.5 py-1 text-[11px] font-bold text-rv-ink">
              <MapPin className="size-3 text-rv-green" />
              {name ? `Near ${name}` : "Near you"}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void locate()}
              className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-rv-pill border border-dashed border-rv-border-hi bg-transparent px-2.5 py-1 text-[11px] font-bold text-rv-ink-faded"
            >
              <MapPinOff className="size-3" />
              Set location
            </button>
          )}
        </div>
        {/* #186 i7 · q9 A: at md+ the grid and the map are always side by
            side, so the switch has no job there. */}
        <div className="md:hidden">
          <ViewSwitch
            value={view}
            onChange={setView}
            fill
            options={[
              { value: "grid", Icon: LayoutGrid, label: "Grid" },
              { value: "map", Icon: MapIcon, label: "Map" },
            ]}
          />
        </div>
      </div>

      <div className="mb-[22px] flex flex-wrap gap-2">
        <FilterChip
          label="All"
          count={counts.All ?? 0}
          active={cat === "All"}
          onClick={() => pickCat("All")}
        />
        {CAT_CHIPS.map((c) => (
          <FilterChip
            key={c.cat}
            label={c.cat}
            type={c.type}
            count={counts[c.cat] ?? 0}
            active={cat === c.cat}
            onClick={() => pickCat(c.cat)}
          />
        ))}
      </div>

      {/* The shipped map lens, below md only (#186 i7): at md+ the panel
          below is the one map, whatever the switch was left on. */}
      {view === "map" && (
        <div className="md:hidden">
          <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_360px]">
            <div className="min-h-[420px]">
              <MapMount pins={lens.pins} unmappedCount={lens.unmapped.length} saves={places} />
            </div>
            <div className="grid content-start gap-3">
              {leading}
              {cards}
            </div>
          </div>
          {hidden > 0 && (
            <p className="m-0 mt-[11px] font-mono text-[11px] text-rv-ink-faded">
              {hidden} {hidden === 1 ? "place" : "places"} hidden by the {cat} filter
            </p>
          )}
        </div>
      )}

      {/* #186 i7 · #185 · q9 A: at md+ the grouped grid on the left and a
          sticky map panel on the right that draws exactly `list`. Below md the
          panel is hidden and this is the shipped grid (or, on Map, hidden). */}
      <div
        className={`${view === "map" ? "hidden md:grid" : "grid"} grid-cols-1 items-start gap-4 md:grid-cols-[1fr_360px]`}
      >
        <div ref={gridRef} className="min-w-0">
          {body}
        </div>
        <aside className="hidden flex-col gap-1.5 md:sticky md:top-0 md:flex">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-rv-ink-faded">
            On the map · {lens.pins.length} of {list.length} listed
          </span>
          <div className="relative">
            <MapMount
              pins={lens.pins}
              unmappedCount={lens.unmapped.length}
              selectedId={selectedId}
              onSelect={selectPin}
              height="520px"
              saves={places}
            />
            {/* #197 · #196: the selected pin's card, with Open → the Place
                view. It takes the corner the unmapped note sits in, so the
                note steps aside while a card is up. */}
            {panelPick ? (
              <PinOpenCard save={panelPick} className="absolute bottom-2 left-2 right-2 z-[3]" />
            ) : (
              lens.pins.length > 0 &&
              lens.unmapped.length > 0 && (
                <span className="pointer-events-none absolute bottom-1.5 right-2 z-[3] font-mono text-[9.5px] text-rv-ink-faded">
                  {lens.unmapped.length} {lens.unmapped.length === 1 ? "has" : "have"} no coordinates
                </span>
              )
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
