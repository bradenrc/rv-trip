import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LineLayerStyle } from "@rnmapbox/maps";
import type { Bounds, OverlayPalette, StyleMode, TripArc, TripStopPin } from "@rv-trip/core";
import {
  ARC_CASING_WIDTH,
  DEFAULT_STYLE_MODE,
  MAP_PALETTE,
  arcFeatureCollection,
  isStyleMode,
  mapBounds,
} from "@rv-trip/core";
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

// ── the style preference ────────────────────────────────────────────────────

/** Where the preference lives — the SAME key the web writes
 * (apps/web/src/components/map/MapMount.tsx:41), per device rather than per
 * browser because AsyncStorage is the device's. */
export const STYLE_PREF_KEY = "rv-map-style";

const STYLE_SEGMENTS: SegmentedOption<StyleMode>[] = [
  { value: "night", label: "Night" },
  { value: "day", label: "Day" },
  { value: "sat", label: "Sat" },
];

/**
 * The persisted basemap choice. `null` until AsyncStorage has answered — one
 * render, covered by the loading frame, so no basemap style is fetched twice.
 *
 * EVERY read is narrowed by core's `isStyleMode`: the stored string is
 * untrusted (a value written by a future release, a hand-edited device store),
 * and an un-narrowed read would hand `MAP_PALETTE[mode]` an undefined column.
 */
export function useStyleMode(): [StyleMode | null, (m: StyleMode) => void] {
  const [mode, setMode] = useState<StyleMode | null>(null);

  useEffect(() => {
    let live = true;
    const settle = (raw: string | null) => {
      if (!live) return;
      setMode(raw !== null && isStyleMode(raw) ? raw : DEFAULT_STYLE_MODE);
    };
    AsyncStorage.getItem(STYLE_PREF_KEY)
      .then(settle)
      // An unreadable store is not a reason to show no map: fall back to the
      // default rather than staying on the loading frame forever.
      .catch(() => settle(null));
    return () => {
      live = false;
    };
  }, []);

  const choose = useCallback((next: StyleMode) => {
    setMode(next);
    void AsyncStorage.setItem(STYLE_PREF_KEY, next).catch(() => {
      // A write that fails costs the reader the preference next launch, nothing
      // more — never the tap they just made.
    });
  }, []);

  return [mode, choose];
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
 * no `pk.*` token or no native module. `empty` is a trip whose every stop is
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
} {
  return {
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
 * A drive's mileage label — "118 mi · US-101" routed, "~98 mi · est." otherwise.
 * A map label answers "how far", not "how long".
 *
 * The same two forms `apps/web/src/components/map/pins.ts:253-256` composes.
 * The copy stayed at the renderers rather than moving into core's `TripArc`
 * (#44 i3) on the premise that the phone would word it differently; the signed
 * wireframe draws it identically, so this is a deliberate second copy of two
 * format strings, flagged in dev-notes rather than quietly forked.
 */
function arcLabel(arc: TripArc): string {
  return arc.source === "here"
    ? [`${arc.miles} mi`, arc.primaryRoad].filter(Boolean).join(" · ")
    : `~${arc.miles} mi · est.`;
}

/**
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

export interface TripMapProps {
  pins: TripStopPin[];
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
   * (MapView.tsx:80) and its mini-map inherits that default, so the web's stop
   * sheet does label its one pin. The phone's mini-map deliberately does not —
   * the sheet names the stop directly above the frame — and making the prop
   * required is what keeps that a decision at each call site rather than an
   * inherited default that can drift.
   */
  showLabels: boolean;
  /** Fixed height in points. Omit to fill the cell (`flex: 1`). */
  height?: number;
}

/**
 * The map. Pins + arcs + mode in, one canvas out.
 *
 * It never filters and it never fetches: it draws exactly what it is handed,
 * from `tripArcs` / `tripStopPins`, both pure functions of the trip the screen
 * already holds.
 */
export function TripMap({
  pins,
  arcs = NO_ARCS,
  mode,
  onModeChange,
  showLabels,
  height,
}: TripMapProps) {
  const palette = MAP_PALETTE[mode];
  const shape = useMemo(() => arcFeatureCollection(arcs), [arcs]);
  const layers = useMemo(() => arcLayerStyles(palette), [palette]);
  // The camera holds the CORRIDOR, not only the pins: US-101 runs west of both
  // Astoria and Newport, so a routed drive's box is wider than its endpoints'.
  const bounds = useMemo(() => mapBounds(arcs, pins), [arcs, pins]);

  const mapbox = mapAvailable() ? loadMapbox() : null;
  if (!mapbox) return <MapFrame state="unavailable" height={height} />;
  if (pins.length === 0) return <MapFrame state="empty" height={height} />;

  const { Camera, LineLayer, MapView, MarkerView, ShapeSource } = mapbox;
  const fit = bounds ? cameraBounds(bounds) : undefined;

  return (
    <View style={[styles.canvas, height != null ? { height } : styles.fill]}>
      <MapView
        style={styles.fill}
        styleURL={MAP_STYLES[mode]}
        scaleBarEnabled={false}
        compassEnabled={false}
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

        {pins.map((pin) => (
          <MarkerView key={pin.id} coordinate={[pin.lng, pin.lat]} allowOverlap>
            <View style={styles.pin}>
              <StopDisc pin={pin} palette={palette} />
              {showLabels && (
                <Text style={[styles.pinLabel, { backgroundColor: palette.labelScrim, color: palette.labelInk }]}>
                  {pin.name}
                </Text>
              )}
            </View>
          </MarkerView>
        ))}
      </MapView>

      {onModeChange && (
        // Over the canvas, never in the chrome — the masthead above already
        // spends its rows on the lens control.
        <View style={styles.stylePill}>
          <Segmented mono value={mode} options={STYLE_SEGMENTS} onChange={onModeChange} />
        </View>
      )}
    </View>
  );
}

/**
 * A trip stop: a numbered disc, green because that is the shipped stop language.
 * A floating stop is an amber DASHED HOLLOW disc with no ordinal — it has no
 * position in the drive sequence, so it gets no number and no arc. The same
 * grammar as MapView.tsx's `StopDisc` (:336-394) minus selection, which the
 * phone has no map interaction to express yet.
 */
function StopDisc({ pin, palette }: { pin: TripStopPin; palette: OverlayPalette }) {
  const floating = pin.floating;
  return (
    <View
      style={[
        styles.disc,
        floating
          ? {
              borderColor: palette.floatingStroke,
              borderStyle: "dashed",
              backgroundColor: palette.hollowGround,
            }
          : { borderColor: palette.discStroke, backgroundColor: palette.discFill },
      ]}
    >
      <Text
        style={[styles.discInk, { color: floating ? palette.floatingStroke : palette.discInk }]}
      >
        {floating ? "◇" : pin.ordinal}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  canvas: { position: "relative", overflow: "hidden" },
  stylePill: { position: "absolute", top: 12, right: 12 },

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
});
