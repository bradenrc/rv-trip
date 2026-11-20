import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LineLayerStyle } from "@rnmapbox/maps";
import type {
  Bounds,
  GoogleAvailability,
  GoogleFallbackReason,
  MapEngine,
  OverlayPalette,
  PrefLocalKey,
  UserPrefs,
  RvCategory,
  StyleMode,
  TripArc,
  TripDestinationPin,
} from "@rv-trip/core";
import {
  ARC_CASING_WIDTH,
  DEFAULT_MAP_ENGINE,
  DEFAULT_STYLE_MODE,
  MAP_ENGINES,
  MAP_ENGINE_FALLBACK_COPY,
  MAP_PALETTE,
  PREF_REMOTE,
  arcFeatureCollection,
  arcLabel,
  isMapEngine,
  isStyleMode,
  mapBounds,
  resolveMapEngine,
  toRemotePatch,
} from "@rv-trip/core";
import { api } from "./api";
import { C, F, R } from "./theme";
import { Segmented, type SegmentedOption } from "./ui";

/**
 * The phone's map: the native half of a grammar that already ships on the web.
 *
 * One `ShapeSource` over core's `tripArcs`, three line layers cased on the ONE
 * predicate `source == "here"`, and numbered discs in the planning layer's
 * green. Every number and every colour comes from the same place the web's
 * `MapView.tsx` reads it from — `@rv-trip/core`'s `MAP_PALETTE` (#44 i3) — so a
 * drive cannot be painted differently on the two clients, and the corridor
 * cannot be drawn twice.
 *
 * Three things are genuinely the phone's and are named as such below: the
 * `mapbox://` style urls (this file is the phone's vendor seam), the lazy
 * `require` that lets a build with no native module degrade to a frame instead
 * of throwing, and the fact that Night is STOCK `dark-v11`. The web repaints
 * night layer by layer through `mapbox-gl`'s `setPaintProperty`
 * (apps/web/src/components/map/nightfall.ts), an API `@rnmapbox/maps` does not
 * expose the same way; the overlay palette — which is what carries the
 * product's identity over the tiles — is identical, and the app opens on Day,
 * which is stock on both clients.
 */

/**
 * The public display token. A `pk.*` key, inlined at bundle time by Expo, and
 * the ONLY Mapbox credential the app holds: the `sk.*` DOWNLOADS:READ token the
 * pods need is a build-time secret in `~/.netrc` and never reaches the bundle
 * (see apps/mobile/README.md). Absent ⇒ the "Map unavailable" frame, which is
 * the default state on a fresh clone and in CI.
 */
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

/**
 * The vendor style url per mode — the phone's own copy of the web's
 * `MAP_STYLES` (MapView.tsx:38-42), because a `mapbox://` string belongs only
 * in a vendor seam and each client has its own. Day and Sat are stock
 * cartography on both. Night is stock here and repainted there.
 */
export const MAP_STYLES: Record<StyleMode, string> = {
  night: "mapbox://styles/mapbox/dark-v11",
  day: "mapbox://styles/mapbox/outdoors-v12",
  sat: "mapbox://styles/mapbox/satellite-streets-v12",
};

type MapboxModule = typeof import("@rnmapbox/maps");

/** `undefined` = not tried yet, `null` = tried and there is no native module. */
let loaded: MapboxModule | null | undefined;

/**
 * The lazy require guard. `@rnmapbox/maps` is a native module behind an Expo
 * config plugin: in a build that has it, this resolves once and the access
 * token is set once; in a build that does not (CI, a snapshot run, a JS-only
 * context) the require throws and every map surface draws a frame instead.
 *
 * It is graceful degradation and nothing else. Expo Go is retired (#44 i1) and
 * this is NOT a compatibility layer for it, it is documented nowhere as a
 * second supported loop, and no screen offers a Google Maps fallback in its
 * place.
 */
function loadMapbox(): MapboxModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@rnmapbox/maps") as MapboxModule;
    void mod.setAccessToken(MAPBOX_TOKEN);
    loaded = mod;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Can this build draw a map at all? No token, or no native module. */
export function mapAvailable(): boolean {
  if (MAPBOX_TOKEN.length === 0) return false;
  return loadMapbox() !== null;
}

// ── the map preferences: style and engine (#198 · q3 B) ─────────────────────

/** Where the preference lives — the SAME key the web writes
 * (apps/web/src/components/map/MapMount.tsx:41). */
export const STYLE_PREF_KEY = "rv-map-style";

/** #198 · the map-engine preference — the web's `ENGINE_PREF_KEY`. */
export const ENGINE_PREF_KEY = "rv-map-engine";

export const STYLE_SEGMENTS: SegmentedOption<StyleMode>[] = [
  { value: "night", label: "Night" },
  { value: "day", label: "Day" },
  { value: "sat", label: "Sat" },
];

/**
 * #198 · whether this build can draw Google. The native renderer lands in #200
 * (`loadGoogle()` → "no-module" when absent); until then every build reports
 * "not-built", so a "google" chosen on the web is kept and Mapbox draws.
 */
export const PHONE_GOOGLE_AVAILABILITY: GoogleAvailability = { ok: false, reason: "not-built" };

/** The engine pill's options, with the chosen-but-undrawable one struck. */
export function engineSegments(fallback: GoogleFallbackReason | null): SegmentedOption<MapEngine>[] {
  return MAP_ENGINES.map(({ value, label }) => ({
    value,
    label,
    struck: value === "google" && fallback !== null,
  }));
}

/** One GET /api/prefs shared by every map preference hook mounting together,
 * so a screen with a map asks once, not once per preference. */
let remoteRead: Promise<UserPrefs | null> | null = null;
function readRemotePrefs(): Promise<UserPrefs | null> {
  remoteRead ??= api.prefs.get().finally(() => {
    remoteRead = null;
  });
  return remoteRead;
}

/**
 * #198 · q3 B — a map preference that follows the ACCOUNT on the phone too:
 * the device's AsyncStorage first (what the first frame reads), then the
 * `user_prefs` row (`GET /api/prefs`), which wins when it has a value — the
 * pattern the You tab's home base already uses. A tap writes locally first and
 * then mirrors ONE field with `PUT /api/prefs`, through core's `toRemotePatch`,
 * exactly like the web's `lib/pref.ts`.
 *
 * `null` until AsyncStorage has answered — one render, covered by the loading
 * frame, so no basemap style is fetched twice.
 *
 * EVERY read is narrowed by `isValid`: the stored string is untrusted (a value
 * written by a future release, a hand-edited device store), and an un-narrowed
 * read would hand `MAP_PALETTE[mode]` an undefined column.
 */
export function usePhonePref<T extends string>(
  key: PrefLocalKey,
  isValid: (v: string) => v is T,
  fallback: T,
): [T | null, (v: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  // A tap made before the account row answers is the newer word: the row must
  // not overwrite it.
  const chosen = useRef(false);

  useEffect(() => {
    let live = true;
    const settle = (raw: string | null) => {
      if (!live || chosen.current) return;
      setValue(raw !== null && isValid(raw) ? raw : fallback);
    };
    AsyncStorage.getItem(key)
      .then(settle)
      // An unreadable store is not a reason to show no map: fall back to the
      // default rather than staying on the loading frame forever.
      .catch(() => settle(null))
      .then(() => readRemotePrefs())
      .then((row) => {
        const remote = row?.[PREF_REMOTE[key]];
        if (!live || chosen.current || typeof remote !== "string" || !isValid(remote)) return;
        setValue(remote);
        void AsyncStorage.setItem(key, remote).catch(() => undefined);
      })
      // No network, no API: the device's copy stands.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, isValid, fallback]);

  const choose = useCallback(
    (next: T) => {
      chosen.current = true;
      setValue(next);
      void AsyncStorage.setItem(key, next).catch(() => {
        // A write that fails costs the reader the preference next launch, nothing
        // more — never the tap they just made.
      });
      void api.prefs.put(toRemotePatch(key, next)).catch(() => {
        // A dead network costs the sync, not the toggle.
      });
    },
    [key],
  );

  return [value, choose];
}

/** The persisted basemap choice. */
export function useStyleMode(): [StyleMode | null, (m: StyleMode) => void] {
  return usePhonePref(STYLE_PREF_KEY, isStyleMode, DEFAULT_STYLE_MODE);
}

/** #198 · the persisted map-engine choice (the account's word, not what draws). */
export function useMapEngine(): [MapEngine | null, (e: MapEngine) => void] {
  return usePhonePref(ENGINE_PREF_KEY, isMapEngine, DEFAULT_MAP_ENGINE);
}

/** #198 · the amber two-line note under the engine pill. */
export function EngineFallbackNote({ reason }: { reason: GoogleFallbackReason }) {
  const copy = MAP_ENGINE_FALLBACK_COPY[reason];
  return (
    <View style={styles.fallbackNote}>
      <Text style={[styles.fallbackText, styles.fallbackTitle]}>{copy.title}</Text>
      <Text style={styles.fallbackText}>{copy.body}</Text>
    </View>
  );
}

// ── the three frames where no map renders ───────────────────────────────────

export type MapFrameState = "loading" | "unavailable" | "empty";

/**
 * The native mirror of `packages/ui/src/MapFrame.tsx`. `packages/ui` is DOM-only
 * by design, so the phone reproduces the three frames as RN views; every string
 * is verbatim from that file (`:33-37` unavailable, `:49-55` empty, `:75-76`
 * loading). Two things cannot cross: lucide icons (this kit ships glyphs, not
 * icons) and the loading frame's CSS `linear-gradient` grid, which would need a
 * gradient dependency to reproduce. The glyph carries the same motif.
 *
 * All three states are reachable on the phone. `unavailable` is the drawn one:
 * no `pk.*` token or no native module. `empty` is a trip whose every destination is
 * coordless. `loading` covers the one render before AsyncStorage answers with
 * the style preference — there is no lazy chunk to wait for on a native map,
 * which is what it covers on the web.
 */
export function MapFrame({
  state,
  count,
  height,
}: {
  state: MapFrameState;
  /** How many coordless points the "empty" frame is standing in for. */
  count?: number;
  /** Fixed height in points. Omit to fill the cell. */
  height?: number;
}) {
  const box = [styles.frame, height != null ? { height } : styles.fill];

  if (state === "unavailable") {
    return (
      <View style={[...box, styles.frameWarn]}>
        <Text style={styles.frameGlyphWarn}>⚠</Text>
        <Text style={styles.frameTitleWarn}>Map unavailable</Text>
        <Text style={styles.frameBodyWarn}>
          The map token isn’t configured for this environment. Everything else on this page still
          works.
        </Text>
      </View>
    );
  }

  if (state === "empty") {
    return (
      <View style={[...box, styles.frameEmpty]}>
        <Text style={styles.frameGlyphMuted}>◌</Text>
        <Text style={styles.frameTitle}>Nothing to map yet</Text>
        <Text style={styles.frameBody}>
          {count == null
            ? "None of these places has coordinates."
            : `None of these ${count} places has coordinates.`}{" "}
          They’re all still in the list.
        </Text>
      </View>
    );
  }

  return (
    <View style={[...box, styles.frameLoading]}>
      <Text style={styles.frameGlyphGreen}>▦</Text>
      <Text style={styles.frameTitle}>Map view</Text>
      <Text style={styles.frameMono}>Loading tiles…</Text>
    </View>
  );
}

// ── the arc grammar ─────────────────────────────────────────────────────────

const SOURCE_ID = "rv-drive-arcs";

/**
 * The one predicate the whole drive-arc grammar is painted by: did HERE answer
 * for this pair? Verbatim from MapView.tsx:50. It is a data-driven expression
 * rather than two sources so a drive rendered twice is unrepresentable.
 */
const ROUTED = ["==", ["get", "source"], "here"] as const;

/** `line-dasharray` is not data-driven, so the dash is its own filtered layer
 * rather than a case on the corridor layer — MapView.tsx:227. */
const ESTIMATE_ONLY = ["==", ["get", "source"], "estimate"] as const;

/** A routed corridor is drawn heavier than the estimate chord it replaces — it
 * is a road, not a guess. The estimate keeps `palette.arcWidth`.
 * MapView.tsx:54. */
const CORRIDOR_WIDTH = 2.6;

/** The shipped estimate's dash, unchanged. MapView.tsx:233. */
const ESTIMATE_DASH = [2.2, 1.8];

/** Fit padding, max zoom and re-fit duration — MapView.tsx:122, verbatim, so
 * the two clients frame the same trip the same way. */
const FIT_PADDING = 56;
const FIT_MAX_ZOOM = 11;
const FIT_DURATION = 600;

/**
 * The three line layers, as paint. One source, three layers, the same widths
 * and the same dash as MapView.tsx:198-235 — one grammar, two renderers.
 *
 * The casing's third `case` term is load-bearing and is NOT `0`: an estimate
 * keeps exactly the casing its mode already gave it, which is sat only (that is
 * the one column where `arcCasing` is non-null, map-palette.ts:197-202). Drop
 * the term and a dashed estimate loses the casing that exists to keep it
 * legible over satellite imagery.
 */
export function arcLayerStyles(palette: OverlayPalette): {
  casing: LineLayerStyle;
  corridor: LineLayerStyle;
  dash: LineLayerStyle;
  joinDash: LineLayerStyle;
} {
  // #179 · the Journal's join: the estimate's dash and paint, with no casing.
  const joinDash: LineLayerStyle = {
    lineCap: "round",
    lineColor: palette.arcLine,
    lineWidth: palette.arcWidth,
    lineOpacity: palette.arcOpacity,
    lineDasharray: ESTIMATE_DASH,
  };
  return {
    joinDash,
    casing: {
      lineCap: "round",
      lineColor: palette.corridorCasing,
      lineWidth: ARC_CASING_WIDTH,
      lineOpacity: ["case", ROUTED, 1, palette.arcCasing ? 1 : 0],
    },
    corridor: {
      lineCap: "round",
      lineColor: palette.arcLine,
      lineWidth: ["case", ROUTED, CORRIDOR_WIDTH, palette.arcWidth],
      lineOpacity: ["case", ROUTED, 1, 0],
    },
    dash: {
      lineCap: "round",
      lineColor: palette.arcLine,
      lineWidth: palette.arcWidth,
      lineOpacity: palette.arcOpacity,
      lineDasharray: ESTIMATE_DASH,
    },
  };
}

/**
 * `arcLabel` — "118 mi · US-101" routed, "~98 mi · est." otherwise — is core's
 * (`planner/map-arcs.ts`), shared verbatim with the web's `/map` overview. It
 * used to be a deliberate second copy of two format strings here, guarded only
 * by a source-text assertion in `mobile-map.test.ts`; #45 made the wording
 * units-aware, and one implementation is the only way the two stay identical.
 * The phone has no units preference of its own yet, so it takes the default.
 *
 * Where that label sits, as `[lng, lat]`. A routed drive labels its corridor's
 * MIDDLE VERTEX — on the road, where the line actually runs; an estimate labels
 * the chord midpoint, because its path is two points. MapView.tsx:305-310.
 */
function labelAt(arc: TripArc): [number, number] {
  if (arc.source === "here" && arc.path.length > 2) {
    return arc.path[Math.floor(arc.path.length / 2)]!;
  }
  return [(arc.from.lng + arc.to.lng) / 2, (arc.from.lat + arc.to.lat) / 2];
}

function cameraBounds(b: Bounds) {
  return {
    ne: [b.east, b.north] as [number, number],
    sw: [b.west, b.south] as [number, number],
    paddingLeft: FIT_PADDING,
    paddingRight: FIT_PADDING,
    paddingTop: FIT_PADDING,
    paddingBottom: FIT_PADDING,
  };
}

const NO_ARCS: TripArc[] = [];
const NO_JOIN: [number, number][] = [];
const NO_ENTRIES: TripMapEntry[] = [];

/** #179 · the Journal join's shape source. */
const JOIN_ID = "rv-journal-join";

/** A destination disc. `been` (#179 · the Journal) draws it hollow — the web's
 * DestinationDisc grammar; absent, it is the planning layer's filled disc. */
export type TripMapPin = TripDestinationPin & { been?: boolean };

/** #179 · a logged place on the Journal map: a small disc in its five-category
 * colour (core's `journalMap` entry points). #186 i6 · q6 A: `been` (a Map tab
 * save on the Been there shelf) draws it as a ring in that colour on
 * `hollowGround` — the web PlaceDrop's filled = want, hollow = been. */
export interface TripMapEntry {
  id: string;
  lat: number;
  lng: number;
  category: RvCategory;
  been?: boolean;
}

export interface TripMapProps {
  pins: TripMapPin[];
  /** Drive corridors from core's `tripArcs`. OMIT for a mini-map: no arcs. */
  arcs?: TripArc[];
  mode: StyleMode;
  /**
   * Present ⇒ the over-canvas Night/Day/Sat pill renders, and the map owns the
   * preference. Omit for a mini-map: 150pt is not a canvas anyone works in, so
   * it follows the preference and offers no control. The pill is structural,
   * not a boolean — a surface with no way to change the mode has no pill to
   * hide.
   */
  onModeChange?: (m: StyleMode) => void;
  /**
   * Name labels under each disc, and the mileage label on each corridor.
   *
   * REQUIRED, with no default, on purpose. The web defaults it to `true`
   * (MapView.tsx:80) and its mini-map inherits that default, so the web's destination
   * sheet does label its one pin. The phone's mini-map deliberately does not —
   * the sheet names the destination directly above the frame — and making the prop
   * required is what keeps that a decision at each call site rather than an
   * inherited default that can drift.
   */
  showLabels: boolean;
  /** Fixed height in points. Omit to fill the cell (`flex: 1`). */
  height?: number;
  /** #179 · the Journal's join: `[lng, lat]` destinations in date order, ONE
   * straight dashed line at the estimate's paint. Never routed, never labelled. */
  join?: [number, number][];
  /** #179 · the Journal's logged places, as small category discs. */
  entries?: TripMapEntry[];
  /** #179 · the lit disc or entry (the web's selection paint). */
  selectedId?: string | null;
  /** #179 · present ⇒ discs and entries are tappable. */
  onSelect?: (id: string) => void;
  /** #186 i6 · a tap on the map itself, off every pin (the Map tab clears its
   * card on it). */
  onPressMap?: () => void;
}

/**
 * The map. Pins + arcs + mode in, one canvas out.
 *
 * It never filters and it never fetches: it draws exactly what it is handed,
 * from `tripArcs` / `tripDestinationPins`, both pure functions of the trip the screen
 * already holds.
 */
export function TripMap({
  pins,
  arcs = NO_ARCS,
  mode,
  onModeChange,
  showLabels,
  height,
  join = NO_JOIN,
  entries = NO_ENTRIES,
  selectedId = null,
  onSelect,
  onPressMap,
}: TripMapProps) {
  const palette = MAP_PALETTE[mode];
  // #198 · the account's engine and what this build draws. Until #200 the
  // resolution is always Mapbox; a "google" choice shows the amber note.
  const [engine, setEngine] = useMapEngine();
  const resolved = resolveMapEngine(engine, PHONE_GOOGLE_AVAILABILITY);
  const shape = useMemo(() => arcFeatureCollection(arcs), [arcs]);
  const layers = useMemo(() => arcLayerStyles(palette), [palette]);
  const joinShape = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: join },
    }),
    [join],
  );
  // The camera holds the CORRIDOR, not only the pins: US-101 runs west of both
  // Astoria and Newport, so a routed drive's box is wider than its endpoints'.
  // A Journal map's logged places are in the box too.
  const bounds = useMemo(
    () => (entries.length > 0 ? mapBounds(arcs, [...pins, ...entries]) : mapBounds(arcs, pins)),
    [arcs, pins, entries],
  );

  const mapbox = mapAvailable() ? loadMapbox() : null;
  if (!mapbox) return <MapFrame state="unavailable" height={height} />;
  if (pins.length === 0 && entries.length === 0) return <MapFrame state="empty" height={height} />;

  const { Camera, LineLayer, MapView, MarkerView, ShapeSource } = mapbox;
  const fit = bounds ? cameraBounds(bounds) : undefined;

  return (
    <View style={[styles.canvas, height != null ? { height } : styles.fill]}>
      <MapView
        style={styles.fill}
        styleURL={MAP_STYLES[mode]}
        scaleBarEnabled={false}
        compassEnabled={false}
        onPress={onPressMap ? () => onPressMap() : undefined}
      >
        <Camera
          // `defaultSettings` frames the trip on mount with no animation, the
          // way the web fits on `load` at duration 0; `bounds` re-fits when the
          // visible set changes, at the web's 600ms.
          defaultSettings={fit ? { bounds: fit } : undefined}
          bounds={fit}
          maxZoomLevel={FIT_MAX_ZOOM}
          animationDuration={FIT_DURATION}
        />

        {arcs.length > 0 && (
          <ShapeSource id={SOURCE_ID} shape={shape}>
            {/* One casing, under a SOLID corridor in every mode — a continuous
                line needs separating from the roads it runs along. */}
            <LineLayer id={`${SOURCE_ID}-casing`} style={layers.casing} />
            {/* The corridor itself. An estimate draws nothing here; its visible
                path is the dash layer below, at the paint it has always had. */}
            <LineLayer id={`${SOURCE_ID}-line`} style={layers.corridor} />
            <LineLayer id={`${SOURCE_ID}-dash`} filter={ESTIMATE_ONLY} style={layers.dash} />
          </ShapeSource>
        )}

        {join.length > 1 && (
          <ShapeSource id={JOIN_ID} shape={joinShape}>
            <LineLayer id={`${JOIN_ID}-dash`} style={layers.joinDash} />
          </ShapeSource>
        )}

        {showLabels &&
          arcs.map((arc) => (
            <MarkerView key={`label-${arc.id}`} coordinate={labelAt(arc)} allowOverlap>
              <View
                style={[
                  styles.arcLabel,
                  { backgroundColor: palette.arcLabelScrim, borderColor: palette.arcLabelBorder },
                ]}
              >
                <Text style={[styles.arcLabelText, { color: palette.arcLabelInk }]}>
                  {arcLabel(arc)}
                </Text>
              </View>
            </MarkerView>
          ))}

        {entries.map((e) => (
          <MarkerView key={e.id} coordinate={[e.lng, e.lat]} allowOverlap>
            <Pressable
              onPress={onSelect ? () => onSelect(e.id) : undefined}
              disabled={!onSelect}
              hitSlop={8}
              accessibilityRole="button"
              style={[
                styles.entry,
                e.been === true
                  ? { backgroundColor: palette.hollowGround, borderColor: palette.category[e.category] }
                  : { backgroundColor: palette.category[e.category], borderColor: palette.hollowGround },
                e.id === selectedId && [styles.entrySel, { borderColor: palette.selStroke }],
              ]}
            />
          </MarkerView>
        ))}

        {pins.map((pin) => (
          <MarkerView key={pin.id} coordinate={[pin.lng, pin.lat]} allowOverlap>
            <Pressable
              onPress={onSelect ? () => onSelect(pin.id) : undefined}
              disabled={!onSelect}
              accessibilityRole="button"
              style={styles.pin}
            >
              <DestinationDisc pin={pin} palette={palette} selected={pin.id === selectedId} />
              {showLabels && (
                <Text style={[styles.pinLabel, { backgroundColor: palette.labelScrim, color: palette.labelInk }]}>
                  {pin.name}
                </Text>
              )}
            </Pressable>
          </MarkerView>
        ))}
      </MapView>

      {onModeChange && (
        // Over the canvas, never in the chrome — the masthead above already
        // spends its rows on the lens control.
        // #198 · q1 A — the engine pill stacks under the style pill.
        <View style={styles.stylePill}>
          <Segmented mono value={mode} options={STYLE_SEGMENTS} onChange={onModeChange} />
          <Segmented
            mono
            value={engine ?? DEFAULT_MAP_ENGINE}
            options={engineSegments(resolved.fallback)}
            onChange={setEngine}
          />
          {resolved.fallback && <EngineFallbackNote reason={resolved.fallback} />}
        </View>
      )}
    </View>
  );
}

// ── the capture pin (#111) ──────────────────────────────────────────────────

/** Street-level: close enough to nudge a pin onto the right pullout. */
const PIN_ZOOM = 14;

/**
 * The pin sub-screen's map (docs/design/111 #100 offline ②): a fixed crosshair
 * over a draggable map, and the map's CENTRE is the pin. Drag the map to nudge
 * the pin; `onMove` reports the new centre when the camera settles.
 *
 * The coordinate is the source of truth, not the tiles — so with no token, no
 * native module, or no tiles (no signal) this draws the design's BLANK GRID
 * with the same crosshair and coordinate, and the pin is still the GPS fix.
 */
export function PinMap({
  at,
  mode,
  onMove,
  label,
  height = 190,
}: {
  at: { lat: number; lng: number };
  mode: StyleMode;
  onMove: (at: { lat: number; lng: number }) => void;
  /** The coordinate line drawn bottom-left ("43.0500, −124.3300"). */
  label: string;
  height?: number;
}) {
  const mapbox = mapAvailable() ? loadMapbox() : null;
  // The first fix frames the map once; after that the user owns the camera.
  const [start] = useState(at);

  return (
    <View style={[styles.pinCanvas, { height }]}>
      {mapbox ? (
        <mapbox.MapView
          style={styles.fill}
          styleURL={MAP_STYLES[mode]}
          scaleBarEnabled={false}
          compassEnabled={false}
          onMapIdle={(state) => {
            const [lng, lat] = state.properties.center;
            if (typeof lat === "number" && typeof lng === "number") onMove({ lat, lng });
          }}
        >
          <mapbox.Camera
            defaultSettings={{ centerCoordinate: [start.lng, start.lat], zoomLevel: PIN_ZOOM }}
          />
        </mapbox.MapView>
      ) : (
        <View style={[styles.fill, styles.pinGrid]}>
          {GRID_LINES.map((i) => (
            <View key={`h${i}`} style={[styles.gridH, { top: i * 28 }]} />
          ))}
          {GRID_LINES.map((i) => (
            <View key={`v${i}`} style={[styles.gridV, { left: i * 28 }]} />
          ))}
        </View>
      )}
      <View pointerEvents="none" style={styles.crosshair}>
        <Text style={styles.crosshairGlyph}>⌖</Text>
      </View>
      <View pointerEvents="none" style={styles.coord}>
        <Text style={styles.coordText}>{label}</Text>
      </View>
    </View>
  );
}

const GRID_LINES = Array.from({ length: 16 }, (_, i) => i + 1);

/**
 * A trip destination: a numbered disc, green because that is the shipped destination language.
 * A floating destination is an amber DASHED HOLLOW disc with no ordinal — it has no
 * position in the drive sequence, so it gets no number and no arc. The same
 * grammar as MapView.tsx's `DestinationDisc` (:336-394) minus selection, which the
 * phone has no map interaction to express yet.
 */
function DestinationDisc({
  pin,
  palette,
  selected = false,
}: {
  pin: TripMapPin;
  palette: OverlayPalette;
  selected?: boolean;
}) {
  const floating = pin.floating;
  // #179 · been = hollow, and the selection paint — MapView.tsx's DestinationDisc.
  const been = pin.been === true;
  const ink = selected
    ? palette.selInk
    : floating
      ? palette.floatingStroke
      : been
        ? palette.discStroke
        : palette.discInk;
  return (
    <View
      style={[
        styles.disc,
        selected
          ? { borderColor: palette.selStroke, backgroundColor: palette.selFill }
          : floating
            ? {
                borderColor: palette.floatingStroke,
                borderStyle: "dashed",
                backgroundColor: palette.hollowGround,
              }
            : { borderColor: palette.discStroke, backgroundColor: been ? palette.hollowGround : palette.discFill },
      ]}
    >
      <Text
        style={[styles.discInk, { color: ink }]}
      >
        {floating ? "◇" : pin.ordinal}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  canvas: { position: "relative", overflow: "hidden" },
  stylePill: { position: "absolute", top: 12, right: 12, alignItems: "flex-end", gap: 6 },
  // #198 · the wireframe's `.fb`: amber on amber-soft, md radius, shadow-rv-md.
  fallbackNote: {
    maxWidth: 220,
    borderWidth: 1,
    borderColor: C.warning,
    backgroundColor: C.warningSoft,
    borderRadius: R.md,
    paddingHorizontal: 8,
    paddingVertical: 4,
    // shadow-rv-md: 0 1px 3px rgba(0,0,0,.36) (packages/ui/styles/entry.css)
    shadowColor: "#000000",
    shadowOpacity: 0.36,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  fallbackText: { fontSize: 10.5, lineHeight: 14, color: C.warning },
  fallbackTitle: { fontWeight: "700" },

  // The disc's geometry is the web's: 27px, 2px border, mono 12px bold.
  disc: {
    width: 27,
    height: 27,
    borderRadius: R.pill,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  discInk: { fontFamily: F.mono, fontSize: 12, fontWeight: "700" },
  pin: { alignItems: "center" },
  // #179 · a Journal entry: the web IdeaRing's 11px, filled in its category.
  entry: { width: 11, height: 11, borderRadius: R.pill, borderWidth: 2 },
  entrySel: { width: 15, height: 15 },
  pinLabel: {
    marginTop: 4,
    fontFamily: F.mono,
    fontSize: 9.5,
    borderRadius: R.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: "hidden",
  },
  arcLabel: { borderRadius: R.pill, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  arcLabelText: { fontFamily: F.mono, fontSize: 9.5 },

  frame: {
    borderRadius: R.card,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  frameWarn: { borderColor: C.warning, backgroundColor: C.warningSoft },
  frameEmpty: { borderColor: C.borderHi, borderStyle: "dashed", backgroundColor: C.surfaceAlt },
  frameLoading: { borderColor: C.border, backgroundColor: C.surfaceAlt },
  frameGlyphWarn: { fontSize: 22, color: C.warning },
  frameGlyphMuted: { fontSize: 22, color: C.inkSubtle },
  frameGlyphGreen: { fontSize: 24, color: C.green },
  frameTitleWarn: { fontSize: 14, fontWeight: "700", color: C.warning },
  frameTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  frameBodyWarn: { fontSize: 12.5, color: C.warning, textAlign: "center", maxWidth: 280 },
  frameBody: { fontSize: 12.5, color: C.inkMuted, textAlign: "center", maxWidth: 280 },
  frameMono: { fontFamily: F.mono, fontSize: 11, color: C.inkFaded },

  // The pin sub-screen — docs/design/111 `.map`: navy-soft ground, a 28pt
  // rv-border grid, a green crosshair, the coordinate in a mono chip.
  pinCanvas: {
    position: "relative",
    overflow: "hidden",
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  pinGrid: { backgroundColor: C.navySoft },
  gridH: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: C.border },
  gridV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: C.border },
  crosshair: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  crosshairGlyph: { fontSize: 30, color: C.green },
  coord: {
    position: "absolute",
    left: 8,
    bottom: 8,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  coordText: { fontFamily: F.mono, fontSize: 10, color: C.inkMuted },
});
