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
import type {
  HowWasIt,
  IdeaCategory,
  JournalEntry,
  RouteDrive,
  RouteHop,
  RouteRow as RouteRowModel,
  TravelMode,
} from "@rv-trip/core";
import {
  dayKindColor,
  setIdeaFields,
  setStopReservationFields,
  fullRange,
  nightsLabel,
  rangeNights,
  tripModeChoice,
  TRIP_MODE_CHOICES,
  routeModel,
  routeSummary,
  timelineModel,
  tripArcs,
  tripStopPins,
} from "@rv-trip/core";
import { MapFrame, TripMap, useStyleMode } from "../../../../../src/map";
import { NearbyBanner, NearbySheet } from "../../../../../src/nearby";
import {
  HopActionSheet,
  HopBookingSheet,
  HopRow,
  MODE_OPTIONS,
  switchHop,
} from "../../../../../src/hops";
import { RoundTripSheet } from "../../../../../src/round-trip";
import {
  AddIdeaSheet,
  AddSheet,
  AddStaySheetPhone,
  AddStopSheet,
  IdeasTab,
} from "../../../../../src/itinerary";
import { queuePatch } from "../../../../../src/capture";
import { HowWasItSheet, JournalView, LastTimeHere } from "../../../../../src/journal";
import {
  addNextTimeIdea,
  dismissNearby,
  isProvisionalIdea,
  updateTrip,
  useBundle,
  useNearby,
  useNextTime,
} from "../../../../../src/store";
import { api } from "../../../../../src/api";
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
 * #131 · Q1 A (docs/design/130 frames 2, 3, 9) — three MINDSET tabs in the
 * masthead: Itinerary · Ideas · Journal, an underline row with the trip's own
 * "+ Add" at its end (the tab-bar + stays #112's global capture). Itinerary's
 * sub-lens is Route · Timeline · Map: Timeline is the rhythm block that used to
 * sit inside Route; Map still renders OUTSIDE the ScrollView — a map's pan
 * gesture and a vertical scroll cannot share a box. A traveled trip (status
 * `complete`) opens on its Journal; otherwise Itinerary ▸ Route.
 */
type Tab = "itinerary" | "ideas" | "journal";
type Sub = "route" | "timeline" | "map";

const SUBS: SegmentedOption<Sub>[] = [
  { value: "route", label: "Route" },
  { value: "timeline", label: "Timeline" },
  { value: "map", label: "Map" },
];

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bundle, error, reload } = useBundle(id);
  const [refreshing, setRefreshing] = useState(false);
  // Null until picked: the tab is DERIVED until then (below).
  const [picked, setTab] = useState<Tab | null>(null);
  const [sub, setSub] = useState<Sub>("route");
  // #131 · the trip's + Add and the sheets it opens.
  const [addOpen, setAddOpen] = useState(false);
  const [flightOpen, setFlightOpen] = useState(false);
  const [stayFor, setStayFor] = useState<{ stopId: string | null } | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [ideaKind, setIdeaKind] = useState<IdeaCategory | null>(null);
  const [mode, setMode] = useStyleMode();
  const router = useRouter();
  // Trip surfacing (#111 i3): the saves near this trip, and the review sheet.
  const { nearby, reload: reloadNearby } = useNearby(id);
  // #113 · #107 "Last time here" — above the banner, which leaves its saves out.
  const { nextTime, reload: reloadNextTime } = useNextTime(id);
  // #113 · a Journal row's "How was it?".
  const [journalEntry, setJournalEntry] = useState<JournalEntry | null>(null);
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
  // The tab is derived until it is picked: a traveled trip opens on Journal.
  const tab: Tab = picked ?? (trip.status === "complete" ? "journal" : "itinerary");
  const lens = tab === "itinerary" ? sub : tab;
  const modeLabel =
    TRIP_MODE_CHOICES.find((c) => c.value === tripModeChoice(trip.defaultMode))?.label ?? "";
  const ideaCount =
    trip.ideas.filter((i) => i.status === "idea").length +
    trip.legs.flatMap((l) => l.stops).flatMap((s) => s.ideas).filter((i) => i.status === "idea").length;
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
      onMode={(m) => switchHop(trip, hop.segmentId, m)}
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
          <Segmented mono value={"drive" as TravelMode} options={MODE_OPTIONS} onChange={(m) => switchHop(trip, drive.segmentId!, m)} />
        )
      }
    />
  );
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), reloadNearby(), reloadNextTime()]);
    setRefreshing(false);
  };

  // #113 · the Journal's trip card — `trips.rating` / `trips.note`.
  const rateTrip = (n: number) => {
    const rating = n === 0 ? null : n;
    updateTrip(trip.id, (t) => ({ ...t, rating }));
    api.trips.patch(trip.id, { rating }).catch(() => void reload());
  };
  const noteTrip = (text: string) => {
    const note = text.trim() === "" ? null : text;
    updateTrip(trip.id, (t) => ({ ...t, note }));
    api.trips.patch(trip.id, { note }).catch(() => void reload());
  };
  /** A Journal row's sheet → the same queued PATCH the stop screen sends. */
  const logEntry = (e: JournalEntry, v: HowWasIt) => {
    setJournalEntry(null);
    const before = { rating: e.rating, again: e.again, notes: e.notes };
    const entity = e.kind;
    const apply = (f: HowWasIt) =>
      updateTrip(trip.id, (t) =>
        entity === "idea" ? setIdeaFields(t, e.id, f) : setStopReservationFields(t, e.id, f),
      );
    apply(v);
    void queuePatch(entity, e.id, v, {
      tripTitle: trip.title,
      undo: () => {
        apply(before);
        void queuePatch(entity, e.id, before);
      },
    });
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
          <Kicker color={C.accent}>
            {[modeLabel, trip.destination?.name].filter(Boolean).join(" · ") || "Trip planner"}
          </Kicker>
          <Text style={styles.h1}>{trip.title}</Text>
          {lens !== "map" ? (
            <>
              <Text style={styles.mono}>
                {fullRange(trip.startDate, trip.endDate)} ·{" "}
                {nightsLabel(rangeNights(trip.startDate, trip.endDate))}
                {trip.homeBase ? ` · from ${trip.homeBase.split(",")[0]}` : ""}
              </Text>
              {lens === "route" && (
                <Text style={[styles.mono, { color: C.warning }]}>{timeline!.openLabel}</Text>
              )}
            </>
          ) : (
            <Text style={styles.mono}>
              {fullRange(trip.startDate, trip.endDate)} · {summary!.stops} stops · {arcs.length}{" "}
              drive{arcs.length === 1 ? "" : "s"}
            </Text>
          )}
          {/* #131 · the mindset tabs, an underline row; the trip's + Add at its end. */}
          <View style={styles.tabs}>
            {(["itinerary", "ideas", "journal"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                style={[styles.tab, tab === t && styles.tabOn]}
              >
                <Text style={[styles.tabText, tab === t && { color: C.ink }]}>
                  {t === "itinerary" ? "Itinerary" : t === "ideas" ? "Ideas" : "Journal"}
                  {t === "ideas" && <Text style={styles.tabCount}> {ideaCount}</Text>}
                </Text>
              </Pressable>
            ))}
            {tab !== "journal" && (
              <Pressable onPress={() => setAddOpen(true)} accessibilityRole="button" style={styles.addPill}>
                <Text style={styles.addPillText}>+ Add</Text>
              </Pressable>
            )}
          </View>
          {tab === "itinerary" && <Segmented value={sub} options={SUBS} onChange={setSub} />}
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
            {lens === "journal" ? (
              <JournalView
                trip={trip}
                onRateTrip={rateTrip}
                onNoteTrip={noteTrip}
                // A Did-it still waiting for signal has no server id to PATCH.
                onOpen={(e) => {
                  if (!isProvisionalIdea(e)) setJournalEntry(e);
                }}
              />
            ) : (
            lens === "ideas" ? (
              <>
                {/* #131 · the maybes live here now: "Last time here" (#113 ·
                    #107), the saves near this trip (#111 i3), and the Ideas
                    list with Plan it. */}
                <LastTimeHere
                  nextTime={nextTime}
                  onAdd={(row) => void addNextTimeIdea(trip.id, row).catch(() => undefined)}
                />
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
                <IdeasTab trip={trip} />
              </>
            ) : lens === "timeline" ? (
              <>
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

              </>
            ) : (
            <>
            {/* Route — legs → stops, drives between */}
            {legs.map((leg) => (
              <View key={leg.id} style={{ gap: 8, marginTop: 6 }}>
                <Kicker>{leg.kicker}</Kicker>
                <Text style={styles.h2}>{leg.name}</Text>
                {leg.leadingHop && hopRow(leg.leadingHop, true)}
                {leg.rows.map((row) => (
                  <View key={row.stop.id} style={{ gap: 8 }}>
                    <StopRow
                      row={row}
                      wholeTrip={row.stop.arriveDate === trip.startDate && row.stop.departDate === trip.endDate}
                      onPress={() => router.push(`/trips/${trip.id}/stops/${row.stop.id}`)}
                      onAddStay={() => setStayFor({ stopId: row.stop.id })}
                    />
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
            </>
            )
            )}
          </ScrollView>
        )}
      </View>
      <HopActionSheet
        visible={menuSeg !== undefined}
        title={menuSeg ? `${stopName(menuSeg.fromStopId)} → ${stopName(menuSeg.toStopId)}` : ""}
        onClose={() => setMenuSegment(null)}
        onPick={(m) => {
          if (menuSegment) switchHop(trip, menuSegment, m);
          setMenuSegment(null);
        }}
      />
      <HopBookingSheet trip={trip} hop={bookingHop} onClose={() => setBookingHop(null)} />
      {addOpen && tab !== "journal" && (
        <AddSheet
          tab={tab}
          onClose={() => setAddOpen(false)}
          onFlight={() => {
            setAddOpen(false);
            setFlightOpen(true);
          }}
          onStay={() => {
            setAddOpen(false);
            setStayFor({ stopId: null });
          }}
          onStop={() => {
            setAddOpen(false);
            setStopOpen(true);
          }}
          onIdea={(k) => {
            setAddOpen(false);
            setIdeaKind(k);
          }}
          onSwitchToIdeas={() => {
            setAddOpen(false);
            setTab("ideas");
          }}
        />
      )}
      {flightOpen && <RoundTripSheet trip={trip} onClose={() => setFlightOpen(false)} />}
      {stayFor && (
        <AddStaySheetPhone
          trip={trip}
          stopId={stayFor.stopId}
          onClose={() => setStayFor(null)}
          onIdeaInstead={() => {
            setStayFor(null);
            setTab("ideas");
            setIdeaKind("stay");
          }}
        />
      )}
      {stopOpen && <AddStopSheet trip={trip} onClose={() => setStopOpen(false)} />}
      {ideaKind && <AddIdeaSheet trip={trip} kind={ideaKind} onClose={() => setIdeaKind(null)} />}
      <HowWasItSheet
        visible={journalEntry !== null}
        name={journalEntry?.name ?? ""}
        done={false}
        initial={journalEntry ?? { rating: null, again: null, notes: null }}
        onLog={(v) => journalEntry && logEntry(journalEntry, v)}
        onSkip={() => setJournalEntry(null)}
      />
      {nearby && (
        <NearbySheet
          tripId={trip.id}
          nearby={nearby}
          visible={reviewing}
          onClose={() => {
            setReviewing(false);
            // What was added drops out of the next read (isAlreadySaved).
            void reloadNearby();
            // …and a Last-time row it matched now reads "On shelf ✓".
            void reloadNextTime();
          }}
        />
      )}
    </>
  );
}

function StopRow({
  row,
  wholeTrip,
  onPress,
  onAddStay,
}: {
  row: RouteRowModel;
  wholeTrip: boolean;
  onPress: () => void;
  /** #128 · Q8 A door 2 — a stop with no stay offers one, dates from the stop. */
  onAddStay: () => void;
}) {
  const hasStay = row.reservations.some((r) => r.type === "lodging" || r.type === "campground");
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => (
        <Card style={{ opacity: pressed ? 0.85 : 1, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={styles.stopName}>{row.stop.place.name}</Text>
            {row.floating && <FloatingTag />}
            {wholeTrip && (
              <View style={styles.wholeTrip}>
                <Text style={styles.wholeTripText}>WHOLE TRIP</Text>
              </View>
            )}
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
          {!hasStay && (
            <Pressable onPress={onAddStay} accessibilityRole="button" style={styles.addStay}>
              <Text style={styles.addStayText}>
                + Add stay <Text style={styles.addStayHint}>· dates from this stop</Text>
              </Text>
            </Pressable>
          )}
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
  tabs: { flexDirection: "row", alignItems: "flex-end", borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, alignItems: "center", paddingTop: 5, paddingBottom: 7, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: C.green },
  tabText: { fontSize: 12, fontWeight: "600", color: C.inkFaded },
  tabCount: { fontFamily: F.mono, fontSize: 9, fontWeight: "500", color: C.inkFaded },
  addPill: {
    marginLeft: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: C.green,
    backgroundColor: C.greenSoft,
    borderRadius: R.pill,
    paddingVertical: 2,
    paddingHorizontal: 9,
  },
  addPillText: { fontSize: 11, fontWeight: "700", color: C.greenInk },
  wholeTrip: {
    marginLeft: "auto",
    borderWidth: 1,
    borderColor: C.green,
    backgroundColor: C.greenSoft,
    borderRadius: R.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  wholeTripText: { fontFamily: F.mono, fontSize: 10, fontWeight: "600", color: C.greenInk },
  addStay: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.green,
    borderRadius: R.md,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  addStayText: { fontSize: 11, fontWeight: "700", color: C.greenInk },
  addStayHint: { fontFamily: F.mono, fontWeight: "400", color: C.inkFaded },
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
