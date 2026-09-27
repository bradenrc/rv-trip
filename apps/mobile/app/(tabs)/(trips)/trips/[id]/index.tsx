import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RouteDrive, RouteHop, RouteRow as RouteRowModel, TravelMode } from "@rv-trip/core";
import {
  dayKindColor,
  fullRange,
  routeModel,
  routeSummary,
  timelineModel,
  tripArcs,
  tripStopPins,
} from "@rv-trip/core";
import { MapFrame, TripMap, useStyleMode } from "../../../../../src/map";
import { IdeasSection, NearbyBanner, NearbySheet } from "../../../../../src/nearby";
import { HopActionSheet, HopBookingSheet, HopRow, MODE_OPTIONS, switchHop } from "../../../../../src/hops";
import { dismissNearby, useBundle, useNearby } from "../../../../../src/store";
import { C, F, R } from "../../../../../src/theme";
import {
  Button,
  Card,
  Centered,
  EstimateChip,
  FloatingTag,
  Kicker,
  Muted,
  Segmented,
  Stars,
  type SegmentedOption,
} from "../../../../../src/ui";

/**
 * The two lenses on one trip (#44 · q1 A): the Route rail as it has always
 * been, and the map of the same drives. The control sits in the masthead ABOVE
 * both, which is what lets the Map lens render OUTSIDE the ScrollView — a map's
 * pan gesture and a vertical scroll cannot share a box.
 */
type Lens = "route" | "map";

const LENSES: SegmentedOption<Lens>[] = [
  { value: "route", label: "Route" },
  { value: "map", label: "Map" },
];

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bundle, error, reload } = useBundle(id);
  const [refreshing, setRefreshing] = useState(false);
  const [lens, setLens] = useState<Lens>("route");
  const [mode, setMode] = useStyleMode();
  const router = useRouter();
  // Trip surfacing (#111 i3): the saves near this trip, and the review sheet.
  const { nearby, reload: reloadNearby } = useNearby(id);
  const [reviewing, setReviewing] = useState(false);
  // #104 · the hop sheets: a drive row's ⋯ (a drive trip) and Add flight/ferry.
  const [menuSegment, setMenuSegment] = useState<string | null>(null);
  const [bookingHop, setBookingHop] = useState<RouteHop | null>(null);

  // The same two models the web planner renders — from @rv-trip/core/planner.
  const timeline = useMemo(() => (bundle ? timelineModel(bundle.trip) : null), [bundle]);
  const legs = useMemo(
    () => (bundle ? routeModel(bundle.trip, bundle.routes, bundle.rigHash) : []),
    [bundle],
  );
  const summary = useMemo(
    () => (bundle ? routeSummary(bundle.trip, bundle.routes, bundle.rigHash) : null),
    [bundle],
  );

  // The map's whole input, from the bundle the screen already holds — two pure
  // calls, no new endpoint and no second derivation. `rigHash` is the routing
  // hash on the wire (apps/web/src/app/api/trips/[id]/route.ts:24), which is
  // what makes a server-resolved corridor findable in `routes`.
  const arcs = useMemo(
    () => (bundle ? tripArcs(bundle.trip, bundle.routes, bundle.rigHash) : []),
    [bundle],
  );
  const pins = useMemo(() => (bundle ? tripStopPins(bundle.trip) : []), [bundle]);

  if (!bundle) {
    return (
      <Centered>
        {error ? (
          <>
            <Text style={{ color: C.ink, fontWeight: "700", fontSize: 17 }}>Couldn’t load this trip</Text>
            <Muted>{error}</Muted>
            <Button onPress={() => void reload()}>Try again</Button>
          </>
        ) : (
          <ActivityIndicator color={C.green} />
        )}
      </Centered>
    );
  }

  const { trip } = bundle;
  // Q7 B: on a drive trip the mode lives in the drive row's ⋯; on a fly trip
  // every hop shows its Segmented.
  const driveTrip = trip.defaultMode === "drive";
  const stopName = (sid: string | null) =>
    sid === null ? "home" : (trip.legs.flatMap((l) => l.stops).find((s) => s.id === sid)?.place.name ?? "");
  const menuSeg = menuSegment ? trip.segments.find((s) => s.id === menuSegment) : undefined;
  const hopRow = (hop: RouteHop, flush: boolean) => (
    <HopRow
      key={hop.segmentId}
      hop={hop}
      flush={flush}
      showSwitch
      onMode={(m) => switchHop(trip.id, hop.segmentId, m)}
      onAdd={() => setBookingHop(hop)}
    />
  );
  const driveRow = (drive: RouteDrive) => (
    <Drive
      drive={drive}
      trailing={
        drive.segmentId === null ? null : driveTrip ? (
          <Pressable
            onPress={() => setMenuSegment(drive.segmentId)}
            accessibilityRole="button"
            accessibilityLabel="Change how this hop travels"
            hitSlop={6}
            style={styles.rowmenu}
          >
            <Text style={{ color: C.inkMuted, fontSize: 13, lineHeight: 14 }}>⋯</Text>
          </Pressable>
        ) : (
          <Segmented mono value={"drive" as TravelMode} options={MODE_OPTIONS} onChange={(m) => switchHop(trip.id, drive.segmentId!, m)} />
        )
      }
    />
  );
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), reloadNearby()]);
    setRefreshing(false);
  };
  const surfaced = nearby && nearby.items.length > 0 ? nearby : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: trip.title,
          // #103 · Edit opens Trip defaults — the setup's three blocks.
          headerRight: () => (
            <Pressable onPress={() => router.push(`/trips/new?edit=${trip.id}`)} hitSlop={8} accessibilityRole="button">
              <Text style={{ color: C.green, fontWeight: "700", fontSize: 14 }}>Edit</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.screen}>
        {/* Masthead — above BOTH lenses, so the map can own the scroll-free
            half of the screen. On the map the date line shortens to the two
            counts: there is no scroll below it to carry the rest. */}
        <View style={styles.masthead}>
          <Kicker color={C.accent}>Trip planner</Kicker>
          <Text style={styles.h1}>{trip.title}</Text>
          {lens === "route" ? (
            <>
              <Text style={styles.mono}>
                {fullRange(trip.startDate, trip.endDate)} · {timeline!.rhythm.length} days
                {trip.homeBase ? ` · from ${trip.homeBase}` : ""}
              </Text>
              <Text style={[styles.mono, { color: C.warning }]}>{timeline!.openLabel}</Text>
            </>
          ) : (
            <Text style={styles.mono}>
              {fullRange(trip.startDate, trip.endDate)} · {summary!.stops} stops · {arcs.length}{" "}
              drive{arcs.length === 1 ? "" : "s"}
            </Text>
          )}
          <Segmented value={lens} options={LENSES} onChange={setLens} />
        </View>

        {lens === "map" ? (
          // Outside the ScrollView, deliberately: a flex:1 View, or the map's
          // pan gesture fights the scroll. `mode === null` is the one render
          // before the device's style preference has been read.
          <View style={styles.mapLens}>
            {mode === null ? (
              <View style={styles.mapFrameBox}>
                <MapFrame state="loading" />
              </View>
            ) : (
              <TripMap pins={pins} arcs={arcs} mode={mode} onModeChange={setMode} showLabels />
            )}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.green} />}
          >
            {/* Trip surfacing (#111 i3) — at the top of the Route lens, above
                the stop rows: the banner (only while a save is surfaced) and
                the compact Ideas shelf. */}
            {surfaced && (
              <NearbyBanner
                nearby={surfaced}
                onOpen={() => setReviewing(true)}
                onDismiss={() =>
                  void dismissNearby(
                    trip.id,
                    surfaced.items.map((i) => i.saveId),
                  ).catch(() => {})
                }
              />
            )}
            <IdeasSection trip={trip} />

            {/* Day strip — the rhythm of the trip, one cell per day */}
            <Card style={{ padding: 10, gap: 6 }}>
              <Kicker>Rhythm</Kicker>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 2 }}>
                  {timeline!.rhythm.map((cell, i) => {
                    const label = timeline!.ruler[i]!;
                    return (
                      <View key={i} style={{ alignItems: "center", gap: 3, width: 16 }}>
                        <View
                          style={{
                            width: 16,
                            height: 18,
                            borderRadius: 3,
                            backgroundColor: dayKindColor(cell.kind),
                            borderWidth: cell.kind === "travel" ? 1 : 0,
                            borderColor: C.borderHi,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {/* #110 §3: fly/ferry days carry a text glyph — native's
                              own idiom (the drive row prints 🚐 as text). */}
                          {modeGlyph(cell.mode) && (
                            <Text style={{ fontSize: 9, lineHeight: 10, color: C.inkMuted }}>
                              {modeGlyph(cell.mode)}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontFamily: F.mono, fontSize: 8, color: label.weekStart ? C.ink : C.inkSubtle }}>
                          {label.letter}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
              {/* Klunk row 3: only the modes this trip's rhythm has. */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <Legend color={C.green} label="Stay" />
                {timeline!.modes.includes("drive") && <Legend color={C.navy} label="Drive" outlined />}
                {timeline!.modes.includes("fly") && <Legend color={C.navy} label="Fly" outlined glyph="✈" />}
                {timeline!.modes.includes("ferry") && <Legend color={C.navy} label="Ferry" outlined glyph="⛴" />}
                <Legend color={C.navySoft} label="Open" />
              </View>
            </Card>

            {/* Route — legs → stops, drives between */}
            {legs.map((leg) => (
              <View key={leg.id} style={{ gap: 8, marginTop: 6 }}>
                <Kicker>{leg.kicker}</Kicker>
                <Text style={styles.h2}>{leg.name}</Text>
                {leg.leadingHop && hopRow(leg.leadingHop, true)}
                {leg.rows.map((row) => (
                  <View key={row.stop.id} style={{ gap: 8 }}>
                    <StopRow row={row} onPress={() => router.push(`/trips/${trip.id}/stops/${row.stop.id}`)} />
                    {row.drive && driveRow(row.drive)}
                    {row.hop && hopRow(row.hop, false)}
                  </View>
                ))}
                {(leg.outboundDrive || leg.outboundHop) && (
                  <View style={{ gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 12 }}>
                      <Kicker>{leg.outboundSeam}</Kicker>
                      <View style={{ flex: 1, height: 1, backgroundColor: C.borderSoft }} />
                    </View>
                    {leg.outboundDrive && driveRow(leg.outboundDrive)}
                    {leg.outboundHop && hopRow(leg.outboundHop, false)}
                  </View>
                )}
                {leg.returnHop && hopRow(leg.returnHop, true)}
              </View>
            ))}

            {/* Floating stops that have no leg row yet are already in the route list; the rail: */}
            <Card style={{ gap: 10, marginTop: 8 }}>
              <Kicker>On the road</Kicker>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={styles.hero}>{summary!.driveMiles || "—"}</Text>
                {summary!.driveMiles > 0 && <Text style={[styles.mono, { fontSize: 14 }]}>mi</Text>}
              </View>
              <Text style={styles.mono}>
                {summary!.driveMiles > 0 ? `${summary!.driveTime} behind the wheel` : "add stops with places to estimate driving"}
              </Text>
              {summary!.restrictionCount > 0 && (
                <Text style={[styles.mono, { color: C.warning }]}>
                  ⚠ {summary!.restrictionCount} restriction{summary!.restrictionCount === 1 ? "" : "s"} on this route
                </Text>
              )}
              {/* Klunk row 4: only a trip that brings the rig is nudged. */}
              {trip.rigOn && !bundle.hasRig && summary!.driveMiles > 0 && (
                <Text style={{ color: C.inkMuted, fontSize: 12.5 }}>
                  Drive times are straight-line estimates until you set up your rig on the web.
                </Text>
              )}
              <View style={{ height: 1, backgroundColor: C.borderSoft }} />
              <Text style={styles.mono}>
                {summary!.stops} stops · {summary!.scheduled} set / {summary!.floating} floating · {summary!.openCount} open
                day{summary!.openCount === 1 ? "" : "s"} in {summary!.gapCount} gap{summary!.gapCount === 1 ? "" : "s"}
              </Text>
            </Card>
          </ScrollView>
        )}
      </View>
      <HopActionSheet
        visible={menuSeg !== undefined}
        title={menuSeg ? `${stopName(menuSeg.fromStopId)} → ${stopName(menuSeg.toStopId)}` : ""}
        onClose={() => setMenuSegment(null)}
        onPick={(m) => {
          if (menuSegment) switchHop(trip.id, menuSegment, m);
          setMenuSegment(null);
        }}
      />
      <HopBookingSheet trip={trip} hop={bookingHop} onClose={() => setBookingHop(null)} />
      {nearby && (
        <NearbySheet
          tripId={trip.id}
          nearby={nearby}
          visible={reviewing}
          onClose={() => {
            setReviewing(false);
            // What was added drops out of the next read (isAlreadySaved).
            void reloadNearby();
          }}
        />
      )}
    </>
  );
}

function StopRow({ row, onPress }: { row: RouteRowModel; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => (
        <Card style={{ opacity: pressed ? 0.85 : 1, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={styles.stopName}>{row.stop.place.name}</Text>
            {row.floating && <FloatingTag />}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {row.dates && <Text style={styles.mono}>{row.dates}</Text>}
            {row.rating > 0 && <Stars value={row.rating} size={12} />}
            {row.reservations.length > 0 && (
              <Text style={styles.mono}>
                {row.reservations.length} reservation{row.reservations.length === 1 ? "" : "s"}
              </Text>
            )}
            {row.ideas.length > 0 && (
              <Text style={styles.mono}>
                {row.ideas.length} idea{row.ideas.length === 1 ? "" : "s"}
              </Text>
            )}
          </View>
          {row.note ? (
            <Text style={{ color: C.inkMuted, fontSize: 13, fontStyle: "italic" }} numberOfLines={2}>
              {row.note}
            </Text>
          ) : null}
        </Card>
      )}
    </Pressable>
  );
}

/**
 * A drive has exactly three renderings, and only one is amber — the same
 * contract as the web's connector: clean · restricted (notices) · estimate.
 * Navigate hands Google Maps origin + destination, never the corridor.
 */
function Drive({ drive, trailing = null }: { drive: RouteDrive; trailing?: React.ReactNode }) {
  const restricted = drive.notices.length > 0;
  return (
    <View
      style={[
        styles.drive,
        restricted && { borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.travel, backgroundColor: C.surface },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ color: C.ink, fontSize: 13 }}>🚐</Text>
        <Text style={[styles.mono, { color: C.inkMuted }]}>{drive.label}</Text>
        {drive.primaryRoad && <Text style={styles.mono}>· {drive.primaryRoad}</Text>}
        {drive.estimate && <EstimateChip />}
        <View style={{ marginLeft: "auto" }}>
          <Button onPress={() => void Linking.openURL(drive.navUrl)}>Navigate</Button>
        </View>
        {trailing}
      </View>
      {restricted && (
        <>
          <Text style={{ color: C.warning, fontSize: 11.5, textAlign: "right" }}>
            Navigation may not follow the RV-safe route — check notices.
          </Text>
          {drive.notices.map((n, i) => (
            <View key={`${n.code}-${i}`} style={styles.notice}>
              <Text style={{ color: C.warning, fontSize: 12.5 }}>⚠ {n.message}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** The text glyph a travel day carries — none for a drive (plain navy). */
function modeGlyph(mode: TravelMode | undefined): string | null {
  return mode === "fly" ? "✈" : mode === "ferry" ? "⛴" : null;
}

function Legend({
  color,
  label,
  outlined,
  glyph,
}: {
  color: string;
  label: string;
  outlined?: boolean;
  glyph?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          backgroundColor: color,
          borderWidth: outlined ? 1 : 0,
          borderColor: C.borderHi,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {glyph && <Text style={{ fontSize: 7, lineHeight: 8, color: C.inkMuted }}>{glyph}</Text>}
      </View>
      <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.inkFaded }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  masthead: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, gap: 10 },
  /** Full-bleed: the map takes every point below the lens control. */
  mapLens: { flex: 1 },
  /** …except a frame, which keeps the body's own gutter. */
  mapFrameBox: { flex: 1, paddingHorizontal: 20, paddingBottom: 20 },
  content: { paddingHorizontal: 20, paddingBottom: 56, gap: 10 },
  h1: { color: C.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.6, marginTop: -4 },
  h2: { color: C.ink, fontSize: 19, fontWeight: "800", marginTop: -4 },
  hero: { fontFamily: F.mono, color: C.ink, fontSize: 30, fontWeight: "700" },
  mono: { fontFamily: F.mono, color: C.inkFaded, fontSize: 12 },
  stopName: { color: C.ink, fontSize: 17, fontWeight: "700" },
  drive: { marginLeft: 12, paddingVertical: 6, paddingHorizontal: 10, borderRadius: R.md, gap: 8 },
  rowmenu: {
    width: 26,
    height: 26,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    backgroundColor: C.warningSoft,
    borderRadius: R.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});
