import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { LibraryFilter, LibraryTrip } from "@rv-trip/core";
import { libraryMap, libraryTrips, localIsoDate } from "@rv-trip/core";
import { MapFrame, TripMap, useStyleMode, type TripMapEntry, type TripMapPin } from "../../src/map";
import { useSaves, useTripTrees } from "../../src/store";
import { C, F, R } from "../../src/theme";
import { CategoryTile, Stars } from "../../src/ui";

/** "1 destination" / "3 destinations" — the chooser's mono line. */
function destinationsLabel(n: number): string {
  return `${n} ${n === 1 ? "destination" : "destinations"}`;
}

/** A destination card's line: "<trip> · stop <n>", plus " · been" once it is
 * behind you. A floating destination has no stop number. */
function destLine(trip: string, ordinal: number | null, been: boolean): string {
  const at = ordinal !== null ? `${trip} · stop ${ordinal}` : `${trip} · floating`;
  return been ? `${at} · been` : at;
}

/**
 * The Map tab (#186 i6 · #184 · docs/design/186 §3 · q6 A · q7 A · q11 A): the
 * library, pinned — every trip destination and every save, under one of four
 * filters (All · Been there · Want to go · One trip).
 *
 * Everything drawn is core's `libraryMap` over the full trips list and the
 * saves, the same rule web /map reads, so the two clients cannot disagree on
 * which pins a filter keeps. Destinations are the shipped numbered discs,
 * hollow once behind you (`destinationBeen`); saves are category dots, filled
 * = Want to go, ring = Been there. The overview draws no drive arcs and never
 * asks a server for a route.
 *
 * Tap a pin to raise its card; tap it again, or the map, to clear it. A
 * destination's card opens the trip with Trip →.
 *
 * #197 · #195 (docs/design/197 frame 10): a save's card opens its Place screen
 * with Open →. The Place screen's "On the map" navigates here with a `place`
 * search param; the tab is usually already mounted, so the param is read in an
 * effect keyed on it (not on mount), selects that pin under All, and is then
 * cleared. A selected save that leaves the library (deleted) clears the card.
 */
export default function MapTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trees, reload: reloadTrees } = useTripTrees();
  const { saves, reload: reloadSaves } = useSaves();
  const [mode] = useStyleMode();
  const [picked, setPicked] = useState<LibraryFilter>({ kind: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const today = localIsoDate();
  const { place } = useLocalSearchParams<{ place?: string }>();

  // "On the map": select the pin under All — a filter could be hiding it.
  useEffect(() => {
    if (!place) return;
    setPicked({ kind: "all" });
    setSelectedId(place);
    router.setParams({ place: undefined });
  }, [place, router]);

  // Fresh on every visit: a save captured or a trip edited on another tab
  // lands here.
  useFocusEffect(
    useCallback(() => {
      void reloadTrees();
      void reloadSaves();
    }, [reloadTrees, reloadSaves]),
  );

  const chooser = useMemo(() => libraryTrips(trees ?? []), [trees]);
  // A picked trip that no longer has a mapped destination falls back to All.
  const pickedTrip: LibraryTrip | null =
    picked.kind === "trip" ? (chooser.find((t) => t.id === picked.tripId) ?? null) : null;
  const filter = useMemo<LibraryFilter>(
    () => (picked.kind === "trip" && pickedTrip === null ? { kind: "all" } : picked),
    [picked, pickedTrip],
  );

  const m = useMemo(() => libraryMap(trees ?? [], saves ?? [], today, filter), [trees, saves, today, filter]);
  const pins = useMemo<TripMapPin[]>(
    () =>
      m.destinations.map((d) => ({
        id: d.id,
        name: d.name,
        lat: d.lat,
        lng: d.lng,
        ordinal: d.ordinal,
        floating: d.ordinal === null,
        been: d.been,
      })),
    [m],
  );
  const entries = useMemo<TripMapEntry[]>(
    () => m.saves.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, category: s.category, been: s.been })),
    [m],
  );

  // The card reads the pin that is still on the map: a chip that hides it
  // clears the card with it.
  const dest = m.destinations.find((d) => d.id === selectedId) ?? null;
  const savePin = dest ? null : (m.saves.find((s) => s.id === selectedId) ?? null);
  const save = savePin ? ((saves ?? []).find((s) => s.id === savePin.id) ?? null) : null;
  const destTrip = dest ? ((trees ?? []).find((t) => t.id === dest.tripId) ?? null) : null;

  const choose = (f: LibraryFilter) => {
    setPicked(f);
    setSelectedId(null);
  };
  const select = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  const loaded = trees !== null && saves !== null && mode !== null;

  // The selected save is gone (deleted on its Place screen): drop the selection.
  useEffect(() => {
    if (loaded && selectedId !== null && !dest && !save) setSelectedId(null);
  }, [loaded, selectedId, dest, save]);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.canvas}>
        {loaded ? (
          <TripMap
            pins={pins}
            entries={entries}
            mode={mode}
            showLabels={false}
            selectedId={selectedId}
            onSelect={select}
            onPressMap={() => setSelectedId(null)}
          />
        ) : (
          <MapFrame state="loading" />
        )}

        <View style={styles.filters} pointerEvents="box-none">
          <MapChip label="All" on={filter.kind === "all"} onPress={() => choose({ kind: "all" })} />
          <MapChip label="Been there" on={filter.kind === "been"} onPress={() => choose({ kind: "been" })} />
          <MapChip label="Want to go" on={filter.kind === "want"} onPress={() => choose({ kind: "want" })} />
          <MapChip
            label={pickedTrip ? pickedTrip.title + " ▾" : "One trip"}
            on={pickedTrip !== null}
            onPress={() => setSheetOpen(true)}
          />
        </View>

        {dest ? (
          <Pressable
            onPress={() => router.push(`/trips/${dest.tripId}`)}
            accessibilityRole="button"
            style={styles.card}
          >
            <View style={styles.cardText}>
              <Text style={styles.cardName} numberOfLines={1}>
                {dest.name}
              </Text>
              <Text style={styles.cardLine} numberOfLines={1}>
                {destLine(destTrip?.title ?? "", dest.ordinal, dest.been)}
              </Text>
            </View>
            <Text style={styles.cardGo}>Trip →</Text>
          </Pressable>
        ) : save ? (
          <Pressable
            onPress={() => router.push({ pathname: "/place/[id]", params: { id: save.id, from: "Map" } })}
            accessibilityRole="button"
            style={styles.card}
          >
            <CategoryTile type={save.type} size={26} />
            <View style={styles.cardText}>
              <Text style={styles.cardName} numberOfLines={1}>
                {save.place.name}
              </Text>
              <Text style={styles.cardLine} numberOfLines={1}>
                {[save.status === "been" ? "Been there" : "Want to go", save.tripName].filter(Boolean).join(" · ")}
              </Text>
            </View>
            {save.rating ? <Stars value={save.rating} size={10} /> : null}
            <Text style={styles.cardOpen}>Open →</Text>
          </Pressable>
        ) : loaded && pins.length + entries.length > 0 ? (
          <Text style={styles.hint}>{`${pins.length + entries.length} pins · tap one`}</Text>
        ) : null}
      </View>

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setSheetOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetHead}>Show one trip</Text>
          {chooser.length === 0 ? (
            <Text style={styles.sheetEmpty}>No trip has a mapped destination yet.</Text>
          ) : (
            chooser.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  choose({ kind: "trip", tripId: t.id });
                  setSheetOpen(false);
                }}
                accessibilityRole="button"
                style={styles.sheetItem}
              >
                <Text style={styles.sheetTitle}>{t.title}</Text>
                <Text style={styles.sheetSub}>
                  {t.dates} · {destinationsLabel(t.destinations)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** docs/design/186's `.mchip`: an over-map filter pill. Active on navy with
 * ink text; idle on surface-alt, border-hi, ink-muted. */
function MapChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      hitSlop={4}
      style={[
        styles.chip,
        on
          ? { backgroundColor: C.navy, borderColor: "transparent" }
          : { backgroundColor: C.surfaceAlt, borderColor: C.borderHi },
      ]}
    >
      <Text style={[styles.chipText, { color: on ? C.ink : C.inkMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surface },
  // .mapfull
  canvas: { flex: 1, position: "relative", overflow: "hidden", backgroundColor: C.surface },
  // .mfilters
  filters: { position: "absolute", left: 10, right: 10, top: 10, flexDirection: "row", flexWrap: "wrap", gap: 5 },
  // .mchip
  chip: {
    borderRadius: R.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    // shadow-rv-sm: 0 1px 2px rgba(0,0,0,.28) (packages/ui/styles/entry.css)
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  // .mcard
  card: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.card,
    paddingVertical: 9,
    paddingHorizontal: 11,
    // shadow-rv-lg: 0 4px 10px -2px rgba(0,0,0,.44) (packages/ui/styles/entry.css)
    shadowColor: "#000000",
    shadowOpacity: 0.44,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardText: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 13, fontWeight: "700", lineHeight: 16, color: C.ink },
  cardLine: { fontSize: 10.5, color: C.inkMuted },
  cardGo: { fontSize: 11, fontWeight: "700", color: C.greenInk },
  // docs/design/197 `.mcard .go` — a save's Open →
  cardOpen: { fontSize: 11.5, fontWeight: "700", color: C.accent },
  // .mhint
  hint: {
    position: "absolute",
    left: 10,
    bottom: 12,
    fontFamily: F.mono,
    fontSize: 9.5,
    color: C.inkFaded,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.pill,
    overflow: "hidden",
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  // .scrim / .sheet2 / .grab
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: C.navy, opacity: 0.6 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderColor: C.borderHi,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 14,
    gap: 2,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: R.pill,
    backgroundColor: C.borderHi,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHead: { fontSize: 13, fontWeight: "800", color: C.ink, paddingTop: 2, paddingHorizontal: 4, paddingBottom: 6 },
  sheetEmpty: { fontFamily: F.mono, fontSize: 10.5, color: C.inkFaded, paddingHorizontal: 4, paddingVertical: 8 },
  sheetItem: { borderTopWidth: 1, borderColor: C.borderSoft, paddingVertical: 8, paddingHorizontal: 4 },
  sheetTitle: { fontSize: 13, fontWeight: "700", color: C.ink },
  sheetSub: { fontFamily: F.mono, fontSize: 9.5, fontWeight: "500", color: C.inkFaded },
});
