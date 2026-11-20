"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Moon, Satellite, Sun } from "lucide-react";
import {
  BUSINESS_CARD_COPY,
  DEFAULT_MAP_ENGINE,
  MAP_ENGINES,
  MAP_ENGINE_FALLBACK_COPY,
  isMapEngine,
  resolveMapEngine,
  businessCard,
  webGoogleAvailability,
  type BusinessCard,
  type GoogleAvailability,
  type GoogleFallbackReason,
  type MapEngine,
  type PlaceDetails,
  type SavedPlace,
} from "@rv-trip/core";
import { CategoryTile, MapFrame, SegmentedControl, type SegmentOption } from "@rv-trip/ui";
import { useStringPref } from "@/lib/pref";
import { tripApi } from "@/lib/trip-api";
import { DEFAULT_STYLE_MODE, isStyleMode, type StyleMode } from "./palette";
import type { DriveArc, MapPin } from "./pins";

/**
 * The single seam every map surface mounts through.
 *
 * `mapbox-gl` touches `window` at import time, so it can only be loaded with
 * `ssr: false` — which Next 16 forbids in a Server Component. This file is the
 * `"use client"` boundary that owns that import, and it is where the three
 * frames with no map in them are chosen: the lazy chunk is still arriving, the
 * publishable token is missing at runtime, or every visible point is coordless.
 * Each frame is a design-system component (`MapFrame`), so no vendor code — and
 * no map-shaped styling — leaks into `packages/ui`.
 *
 * It also owns the style mode (issue #12), for the same reason. The preference
 * is client-only and has to be resolved BEFORE the lazy chunk mounts, or a Day
 * reader watches a Night basemap load and then get thrown away; a control
 * inside `MapView` could neither render during the loading frame nor hand the
 * resolved mode back across the lazy boundary. So the mode, its persistence and
 * the control live here, and `MapView` takes `mode` as a prop and stays a pure
 * renderer. All three surfaces inherit the one preference.
 *
 * Note that nothing is imported from `./MapView` at module scope: this
 * component executes during SSR, and the mode vocabulary therefore lives in the
 * vendor-free `./palette` rather than beside the `mapbox://` urls.
 *
 * #199 · it is also where the ENGINE is chosen. `./GoogleMapView` is the second
 * renderer and is reached the same way, through its own lazy `dynamic()`
 * import, so a Mapbox reader never downloads Google code and a Google reader
 * never downloads mapbox-gl.
 */

const LazyMapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <MapFrame state="loading" />,
});

const LazyGoogleMapView = dynamic(
  () => import("./GoogleMapView").then((m) => m.GoogleMapView),
  { ssr: false, loading: () => <MapFrame state="loading" /> },
);

/** Where the preference lives. Flat and dash-cased, like `rv-track-costs`
 * (TripPlanner.tsx:67). */
export const STYLE_PREF_KEY = "rv-map-style";

/** The three options every map offers. Exported because Settings' "Default map
 * style" row is a second front door onto the SAME preference, and a second copy
 * of the list would be a second vocabulary. */
export const STYLE_SEGMENTS: SegmentOption<StyleMode>[] = [
  { value: "night", label: "Night", Icon: Moon },
  { value: "day", label: "Day", Icon: Sun },
  { value: "sat", label: "Sat", Icon: Satellite },
];

/** #198 · the map-engine preference (docs/design/202). Mirrored to
 * `user_prefs.map_engine` by `lib/pref.ts` like every other mapped key. */
export const ENGINE_PREF_KEY = "rv-map-engine";

/**
 * #199 · whether THIS web build can draw Google: the browser Maps JS key AND
 * the Map ID, else "no-key" (q4 A, core's `webGoogleAvailability`). Both env
 * reads are written out literally so Next inlines them at build time. Walks
 * and CI set neither, so they draw Mapbox with the "no-key" note.
 */
export const WEB_GOOGLE_AVAILABILITY: GoogleAvailability = webGoogleAvailability(
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY,
  process.env.NEXT_PUBLIC_GOOGLE_MAP_ID,
);

/** The engine pill's two options — Mapbox · Google, no glyphs. `struck` marks
 * Google when it is the choice but can't be drawn here (q2 A). Exported for
 * Settings' "Map engine" row, the second front door onto the same preference. */
export function engineSegments(fallback: GoogleFallbackReason | null): SegmentOption<MapEngine>[] {
  return MAP_ENGINES.map(({ value, label }) => ({
    value,
    label,
    struck: value === "google" && fallback !== null,
  }));
}

/** The amber two-line note under the engine pill when Google is chosen but
 * Mapbox draws. */
function EngineFallbackNote({ reason }: { reason: GoogleFallbackReason }) {
  const copy = MAP_ENGINE_FALLBACK_COPY[reason];
  return (
    <div className="max-w-[220px] rounded-rv-md border border-rv-warning bg-rv-warning-soft px-2 py-1 text-left text-[10.5px] leading-[1.35] text-rv-warning shadow-rv-md">
      <b className="block font-bold">{copy.title}</b>
      {copy.body}
    </div>
  );
}

export interface MapMountProps {
  pins: MapPin[];
  arcs?: DriveArc[];
  /** #179 · the Journal map's join: `[lng, lat]` destinations in date order,
   * drawn as one dashed line. Never routed, never labelled. */
  join?: [number, number][];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  showLabels?: boolean;
  /** CSS length for the map's box. Omit to fill the cell it sits in. */
  height?: string;
  /** How many points were dropped for having no coordinates — the honest count
   * behind the "nothing to map yet" frame. */
  unmappedCount?: number;
  /** The over-canvas style pill. Off for the destination sheet's mini-map, which
   * follows the preference but is too small to carry a control. */
  showStyleControl?: boolean;
  /** #201 · the owner's library. Present ⇒ on the Google engine a basemap
   * business can be tapped, and its card offers Save, or Open → when the
   * library already holds it (core's `businessCard`). Absent (the destination
   * mini-map) ⇒ no business taps. */
  saves?: readonly SavedPlace[];
  /** #201 · where the business card sits. Defaults to the shipped pin-card
   * slot (`PinOpenCard`'s corner), so it covers a pin card while it is up. */
  businessCardClassName?: string;
}

/** The shipped pin-card slot (PlacesLibrary / JournalMap's `PinOpenCard`). */
const PIN_CARD_SLOT = "absolute bottom-2 left-2 right-2 z-[4]";

/** A tapped business: its id, and Google's answer once details lands
 * (`undefined` while it is in flight, `null` when it named nothing). */
interface TappedState {
  googlePlaceId: string;
  details: PlaceDetails | null | undefined;
}

/**
 * #201 · the card a tapped business raises (docs/design/202 §1 `.mcard`): the
 * tile, the name, the town with a "Google place" tag, and Save — or, already
 * in the library, "· saved" and Open → its Place view.
 */
function BusinessCardView({
  card,
  onSave,
  className,
}: {
  card: BusinessCard;
  onSave: () => void;
  className: string;
}) {
  const saved = card.action.kind === "open";
  return (
    <div
      className={`flex items-center gap-2.5 rounded-rv-card border border-rv-border-hi bg-rv-surface px-[11px] py-[9px] shadow-rv-xl ${className}`}
    >
      <CategoryTile type={card.type} size="sm" />
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[13px] font-bold text-rv-ink">{card.name}</b>
        <span className="block truncate font-mono text-[10px] text-rv-ink-faded">
          {card.area}
          <span className="ml-1 rounded-rv-pill border border-rv-border-hi px-1.5 font-mono text-[9px] text-rv-ink-faded">
            {BUSINESS_CARD_COPY.tag}
          </span>
          {saved && ` · ${BUSINESS_CARD_COPY.saved}`}
        </span>
      </div>
      {card.action.kind === "open" ? (
        <Link
          href={`/places/${card.action.save.id}`}
          className="whitespace-nowrap text-[12px] font-bold text-rv-accent no-underline"
        >
          {BUSINESS_CARD_COPY.open}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onSave}
          className="inline-block cursor-pointer rounded-rv-md border-0 bg-rv-accent-deep px-[13px] py-[7px] text-[12.5px] font-bold text-rv-accent-ink"
        >
          {BUSINESS_CARD_COPY.save}
        </button>
      )}
    </div>
  );
}

export function MapMount({
  pins,
  arcs,
  join,
  selectedId,
  onSelect,
  showLabels,
  height,
  unmappedCount,
  showStyleControl = true,
  saves,
  businessCardClassName = PIN_CARD_SLOT,
}: MapMountProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  // null until the client has read the preference — one render, covered by the
  // same loading frame the lazy chunk already shows, so nothing reflows and no
  // basemap style is fetched twice.
  const [mode, setMode] = useStringPref(STYLE_PREF_KEY, isStyleMode, DEFAULT_STYLE_MODE);
  // #198 · the account's engine choice, and what this client actually draws.
  // The choice is never written back by the client on its own: only a tap
  // writes.
  const [engine, setEngine] = useStringPref(ENGINE_PREF_KEY, isMapEngine, DEFAULT_MAP_ENGINE);
  const resolved = resolveMapEngine(engine, WEB_GOOGLE_AVAILABILITY);
  // #199 · Google needs no Mapbox token, so a Google reader still gets a map
  // on a build without one; Mapbox without a token is the "unavailable" frame.
  const drawable = resolved.engine === "google" || Boolean(token);

  // #201 · the tapped business, named by one details call per tap. A later
  // tap outruns an earlier answer: only the latest id's answer lands.
  const [business, setBusiness] = useState<TappedState | null>(null);
  const latest = useRef<string | null>(null);
  const tapBusiness = (googlePlaceId: string | null) => {
    latest.current = googlePlaceId;
    if (googlePlaceId === null) {
      setBusiness(null);
      return;
    }
    setBusiness({ googlePlaceId, details: undefined });
    void tripApi.placeDetails(googlePlaceId).then((env) => {
      if (latest.current !== googlePlaceId) return;
      setBusiness({ googlePlaceId, details: env.results[0] ?? null });
    });
  };
  const card =
    business && saves
      ? businessCard(
          {
            googlePlaceId: business.googlePlaceId,
            name: business.details?.name ?? null,
            lat: business.details?.location?.lat ?? null,
            lng: business.details?.location?.lng ?? null,
            address: business.details?.address ?? null,
            primaryType: business.details?.primaryType ?? null,
          },
          saves,
        )
      : null;
  // One card on screen at a time: a pin tap closes the business card, and so
  // does switching engine (Mapbox's basemap carries no Google place id).
  const selectPin = (id: string) => { setBusiness(null); onSelect?.(id); };
  const chooseEngine = (e: MapEngine) => { setBusiness(null); setEngine(e); };
  // Save opens the shipped capture sheet at the pick (Nav listens).
  const saveBusiness = () => {
    if (!card) return;
    window.dispatchEvent(new CustomEvent("rv:capture", { detail: { googlePlaceId: card.googlePlaceId } }));
    setBusiness(null);
  };

  return (
    <div className={height ? undefined : "h-full min-h-[150px]"} style={height ? { height } : undefined}>
      {!drawable ? (
        <MapFrame state="unavailable" />
      ) : pins.length === 0 ? (
        <MapFrame state="empty" count={unmappedCount} />
      ) : mode === null || engine === null ? (
        // Both preferences resolve in the same first client render; waiting on
        // the engine too means a Google reader never loads mapbox-gl first.
        <MapFrame state="loading" />
      ) : (
        <div className="relative h-full overflow-hidden rounded-rv-card border border-rv-border">
          {resolved.engine === "google" ? (
            <LazyGoogleMapView
              pins={pins}
              arcs={arcs}
              join={join}
              selectedId={selectedId}
              onSelect={onSelect ? selectPin : undefined}
              showLabels={showLabels}
              mode={mode}
              onBusiness={saves ? tapBusiness : undefined}
            />
          ) : (
            <LazyMapView
              pins={pins}
              arcs={arcs}
              join={join}
              selectedId={selectedId}
              onSelect={onSelect}
              showLabels={showLabels}
              token={token ?? ""}
              mode={mode}
            />
          )}
          {showStyleControl && (
            // Over the canvas, never in the chrome: every surface that mounts a
            // map already spends a row or two on controls, and a third would
            // push the map below the fold on a laptop.
            // #198 · q1 A — the engine pill stacks under the style pill, and the
            // amber fallback note under that.
            <div className="absolute right-3 top-3 z-[3] flex flex-col items-end gap-1.5">
              <div className="rounded-rv-pill shadow-rv-lg">
                <SegmentedControl mono value={mode} options={STYLE_SEGMENTS} onChange={setMode} />
              </div>
              <div className="rounded-rv-pill shadow-rv-lg">
                <SegmentedControl
                  mono
                  value={engine ?? DEFAULT_MAP_ENGINE}
                  options={engineSegments(resolved.fallback)}
                  onChange={chooseEngine}
                />
              </div>
              {resolved.fallback && <EngineFallbackNote reason={resolved.fallback} />}
            </div>
          )}
          {resolved.engine === "google" && card && (
            <BusinessCardView card={card} onSave={saveBusiness} className={businessCardClassName} />
          )}
        </div>
      )}
    </div>
  );
}
