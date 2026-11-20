import type { CategoryLabel } from "@rv-trip/ui";
import { markerShadow, type OverlayPalette } from "./palette";
import type { DriveArc, MapPin } from "./pins";
import type { SpiderPlacement } from "@rv-trip/core";

/**
 * #199 · the marks drawn ON a map, shared by both engines (docs/design/202 §1:
 * "the numbered destination discs, the HERE corridor, the estimate, the
 * floating ◇ and your saves keep their MAP_PALETTE colours").
 *
 * These were `MapView.tsx`'s own functions until the Google engine landed. They
 * moved here, unchanged, because `GoogleMapView` draws the same HTML discs as
 * Advanced Marker content, and importing them from `MapView.tsx` would drag
 * `react-map-gl` + `mapbox-gl` into the Google chunk. This module is
 * vendor-free: plain React + the palette.
 */

/** One pin's whole mark: the spider leader (when nudged), the glyph for its
 * kind, and its name label. Both engines place this at the pin's coordinate,
 * offset by the spiderfy nudge. */
export function PinMark({
  pin,
  at,
  selected,
  palette,
  showLabels,
}: {
  pin: MapPin;
  at: SpiderPlacement | undefined;
  selected: boolean;
  palette: OverlayPalette;
  showLabels: boolean;
}) {
  const dx = at?.dx ?? 0;
  const dy = at?.dy ?? 0;
  return (
    <div className="relative">
      {at?.spiderfied && <SpiderLeader dx={dx} dy={dy} palette={palette} />}
      {pin.kind === "destination" ? (
        <DestinationDisc pin={pin} selected={selected} palette={palette} />
      ) : pin.kind === "place" ? (
        <PlaceDrop pin={pin} selected={selected} palette={palette} />
      ) : (
        <IdeaRing selected={selected} palette={palette} category={pin.category} />
      )}
      {showLabels && (
        <span
          className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-rv-sm px-[5px] py-px font-mono text-[9.5px]"
          style={{
            background: palette.labelScrim,
            color: selected ? palette.labelInkSelected : palette.labelInk,
          }}
        >
          {pin.name}
        </span>
      )}
    </div>
  );
}

/** Three tiers under the selection: a destination is a commitment, a saved
 * place is a want, an idea is a maybe — so an idea can never cover the
 * destination it belongs to. */
export function markerTier(pin: MapPin, selected: boolean): number {
  return selected ? 4 : pin.kind === "destination" ? 3 : pin.kind === "place" ? 2 : 1;
}

/** A drive's mileage chip, placed at `labelAt(arc)`. */
export function ArcLabel({ label, palette }: { label: string; palette: OverlayPalette }) {
  return (
    <span
      className="whitespace-nowrap rounded-rv-pill border px-1.5 py-0.5 font-mono text-[9.5px]"
      style={{
        background: palette.arcLabelScrim,
        borderColor: palette.arcLabelBorder,
        color: palette.arcLabelInk,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Where a drive's mileage label sits, as `[lng, lat]`.
 *
 * A routed drive labels its corridor's MIDDLE VERTEX — on the road, where the
 * line actually runs. An estimate labels the chord midpoint, exactly as it
 * always has: its path is two points, so the vertex and the midpoint are not
 * the same thing and the chord is the honest one.
 */
export function labelAt(a: DriveArc): [number, number] {
  if (a.source === "here" && a.path.length > 2) {
    return a.path[Math.floor(a.path.length / 2)]!;
  }
  return [(a.from.lng + a.to.lng) / 2, (a.from.lat + a.to.lat) / 2];
}

/** 1px dashed leader from a nudged pin back to its true coordinate. */
function SpiderLeader({ dx, dy, palette }: { dx: number; dy: number; palette: OverlayPalette }) {
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(-dy, -dx) * 180) / Math.PI;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 border-t border-dashed"
      style={{
        width: length,
        borderTopColor: palette.leader,
        transformOrigin: "0 0",
        transform: `rotate(${angle}deg)`,
      }}
    />
  );
}

/**
 * A trip destination: a numbered disc, green because that is the shipped destination language
 * (DestinationBar, packages/ui/src/Gantt.tsx:130). Filled = ahead of you, hollow = been
 * there. A floating destination is an amber dashed disc with no ordinal — it has no
 * position in the drive sequence, so it gets no number and no arc.
 */
function DestinationDisc({
  pin,
  selected,
  palette,
}: {
  pin: Extract<MapPin, { kind: "destination" }>;
  selected: boolean;
  palette: OverlayPalette;
}) {
  // #186 i6 · q7 A: the destination's own been (core's `destinationBeen`), so a
  // trip in progress draws its past stops hollow and the rest filled.
  const been = pin.been;
  // Layout only. Every colour on this disc used to be a Tailwind `rv-*` class,
  // and every one of those was a Night literal frozen into a class name — so
  // colour moves to the palette and the geometry stays where it was.
  const base =
    "flex size-[27px] items-center justify-center rounded-rv-pill border-2 font-mono text-[12px] font-bold";
  if (selected) {
    return (
      <div
        className={base}
        style={{
          borderColor: palette.selStroke,
          background: palette.selFill,
          color: palette.selInk,
          boxShadow: markerShadow("xl", palette, true),
        }}
      >
        {pin.floating ? "◇" : pin.ordinal}
      </div>
    );
  }
  if (pin.floating) {
    return (
      <div
        className={`${base} border-dashed text-[13px]`}
        style={{
          borderColor: palette.floatingStroke,
          background: palette.hollowGround,
          color: palette.floatingStroke,
          boxShadow: markerShadow("md", palette, false),
        }}
      >
        ◇
      </div>
    );
  }
  return (
    <div
      className={base}
      style={{
        borderColor: palette.discStroke,
        background: been ? palette.hollowGround : palette.discFill,
        color: been ? palette.discStroke : palette.discInk,
        boxShadow: markerShadow(been ? "md" : "lg", palette, false),
      }}
    >
      {pin.ordinal}
    </div>
  );
}

/**
 * A saved place: a category-coloured teardrop. Filled = want to go, hollow =
 * been there — the same filled/hollow rule the destination discs use, so one rule reads
 * across the whole map.
 */
function PlaceDrop({
  pin,
  selected,
  palette,
}: {
  pin: Extract<MapPin, { kind: "place" }>;
  selected: boolean;
  palette: OverlayPalette;
}) {
  // The five-category *meanings* are unchanged — `pin.category` is still
  // resolved through `categoryMeta` (pins.ts:217). Only the value flips, and
  // only on the canvas: the chip row above the map keeps the Nightfall swatch.
  const color = palette.category[pin.category];
  const been = pin.status === "been";
  return (
    <div
      className="size-[19px] border-2"
      style={{
        borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)",
        background: been ? palette.hollowGround : color,
        borderColor: been ? color : "transparent",
        boxShadow: markerShadow(selected ? "xl" : "md", palette, selected),
      }}
    >
      <div
        className="mx-auto mt-1 size-1.5 rounded-full"
        style={{ background: been ? color : palette.dropDot }}
      />
    </div>
  );
}

/**
 * An idea: an 11px ring in the Do/activity colour — under half the 27px destination
 * disc, which is the whole point. A maybe reads smaller than a commitment,
 * carries no number and is never an arc endpoint.
 *
 * The colour resolves through `palette.category.Do`, the same key `PlaceDrop`
 * already reads, so this adds no palette key and no map-palette test churn.
 *
 * Two legibility fixes from the #69 walk (#80 i4), both inside the shipped
 * vocabulary rather than a new one:
 *
 * - The ring's centre is `hollowGround`, not `transparent`. An 11px unfilled
 *   ring disappears into the cartography at real zoom — worst on sat, where a
 *   photograph runs straight through it. `hollowGround` is the ground the
 *   "been there" disc already uses, so the ring stays HOLLOW in the grammar's
 *   sense (not a commitment) while reading against any basemap.
 * - Selection repaints, rather than only re-shadowing. It used to change its
 *   box-shadow alone, so picking an idea from the rail barely moved anything on
 *   the canvas while a destination and a saved place both repaint. Same two selection
 *   keys `DestinationDisc` takes, same 11px, still no number.
 */
function IdeaRing({
  selected,
  palette,
  category,
}: {
  selected: boolean;
  palette: OverlayPalette;
  /** #179 · a Journal entry: a small disc FILLED in its category colour on the
   * hollow ground's ring (docs/design/181 frame 5). Absent: the Do ring. */
  category?: CategoryLabel;
}) {
  const fill = category ? palette.category[category] : null;
  return (
    <div
      className="size-[11px] rounded-full border-2"
      style={{
        borderColor: selected ? palette.selStroke : fill ? palette.hollowGround : palette.category.Do,
        background: selected ? palette.selFill : (fill ?? palette.hollowGround),
        boxShadow: markerShadow(selected ? "lg" : "sm", palette, selected),
      }}
    />
  );
}
