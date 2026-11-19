import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import type {
  LatLng,
  PlacesCategory,
  ReservationType,
  SavedPlace,
  SavedPlaceStatus,
  SavesShelves,
  TripCard,
} from "@rv-trip/core";
import {
  PLACES_CATEGORIES,
  isPlacesCategory,
  localIsoDate,
  nearYou,
  nearYouName,
  nearYouNothing,
  nearYouWithin,
  placesCategoryEmpty,
  queuedToast,
  saveRowLine,
  shelfCounts,
  tripCard,
  tripCardLines,
} from "@rv-trip/core";
import { API_URL, api } from "../../src/api";
import { publishPlacesShelf, useCaptureState } from "../../src/capture";
import { Suggestion } from "../../src/places";
import { useSaves, useTripTrees } from "../../src/store";
import { C, F, R } from "../../src/theme";
import { Button, CategoryTile, Centered, FilterChip, Kicker, Muted, Stars, Toast } from "../../src/ui";

/** The chosen chip, remembered on this phone (#186 i2 · q4 A) — the web's key too. */
const CAT_KEY = "rv-places-cat";

/** One representative type per chip, so the glyph takes the category's colour from core. */
const CAT_TYPE: Record<Exclude<PlacesCategory, "All">, ReservationType> = {
  Stay: "campground",
  Eat: "dining",
  Do: "activity",
};

/**
 * The Places tab (#111 i2 · docs/design/111 "The Saves tab", Q4 B · Q5 A;
 * retitled Places by #173 i2 · Q6 A — the route keeps the name `saves`).
 *
 * Want to go / Been there, then the shelf as core's `savesShelves` groups it:
 * region headers by save count, areas alphabetically under each, saves
 * newest first, and the Unanchored group last. A save with a pending place
 * suggestion (Q3 A) gets the rv-info strip — tap it to upgrade, or Dismiss.
 *
 * While captures are waiting for signal the amber queue line (i1) sits on top.
 *
 * #186 i2 · #182 (docs/design/186 §2 · q1 A · q3 A · q4 A): a location chip
 * beside the title, All · Stay · Eat · Do chips under the shelf switch, and —
 * when the phone knows where it is — a "Near you" group (core's `nearYou`,
 * within NEAR_RADIUS_MI) above "Everywhere else", the shipped groups. The tab
 * never asks for location on its own: it reads the permission on focus and
 * asks only when the "Set location" chip is tapped.
 *
 * #186 i4 · #183 (q5 A): above the shelf switch, the trip card — core's
 * `tripCard` over the full trips list (`useTripTrees`) — for a trip in the week
 * before, during or after it. Tapping it opens the trip.
 */
export default function SavesTab() {
  const { queue } = useCaptureState();
  const { saves, error, reload } = useSaves();
  const { trees, reload: reloadTrees } = useTripTrees();
  const card = tripCard(trees ?? [], localIsoDate());
  const [status, setStatus] = useState<SavedPlaceStatus>("want");
  const [cat, setCat] = useState<PlacesCategory>("All");
  const [refreshing, setRefreshing] = useState(false);
  const { here, ask: onAsk } = useHere();
  const navigation = useNavigation();

  // The remembered chip, read once AsyncStorage answers (q4 A).
  useEffect(() => {
    AsyncStorage.getItem(CAT_KEY)
      .then((v) => {
        if (isPlacesCategory(v)) setCat(v);
      })
      .catch(() => undefined);
  }, []);
  const pickCat = (c: PlacesCategory) => {
    setCat(c);
    void AsyncStorage.setItem(CAT_KEY, c).catch(() => undefined);
  };
  // Switching shelves resets the chip to All — and remembers All (q4 A).
  const changeShelf = (s: SavedPlaceStatus) => {
    setStatus(s);
    pickCat("All");
  };

  const library = saves ?? [];
  // The chip's name reads the shelf's All list, so it does not move with the chip.
  const nearAll = here ? nearYou(library, status, here, "All").near : [];
  const areaName = nearYouName(nearAll, null);
  const resolved = useResolvedName(areaName === null ? here : null);
  const name = here ? nearYouName(nearAll, resolved) : null;

  // Fresh on every visit: a capture made from another tab lands here.
  // The trip trees too: a trip edited on the Trips tab changes the card.
  useFocusEffect(
    useCallback(() => {
      void reload();
      void reloadTrees();
    }, [reload, reloadTrees]),
  );

  // #186 i9 (#160 · q10 A): the shelf you are on is published while this tab
  // is focused, so ＋ opens the capture sheet on it. The sheet is a root
  // formSheet, which blurs this tab too — so a blur clears it only when Places
  // is no longer the selected tab.
  useFocusEffect(
    useCallback(() => {
      publishPlacesShelf(status);
      return () => {
        if (!stillShowing(navigation)) publishPlacesShelf(null);
      };
    }, [status, navigation]),
  );
  // …and whenever the queue drains, since a flush is new rows on the server.
  const waitingBefore = useRef(queue.length);
  useEffect(() => {
    if (queue.length < waitingBefore.current) void reload();
    waitingBefore.current = queue.length;
  }, [queue.length, reload]);

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const waiting = queuedToast(queue.length);
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.nav}>
        <Kicker color={C.green}>Heard about · been to</Kicker>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Places</Text>
          <LocationChip here={here} name={name} onAsk={onAsk} />
        </View>
      </View>
      {saves === null && !error ? (
        <Centered>
          <ActivityIndicator color={C.green} />
        </Centered>
      ) : error && !saves ? (
        <Centered>
          <Text style={{ color: C.ink, fontWeight: "700", fontSize: 17 }}>Couldn’t reach the hub</Text>
          <Muted>{API_URL}</Muted>
          <Muted>{error}</Muted>
          <Button onPress={() => void reload()}>Try again</Button>
        </Centered>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.green} />}
        >
          {queue.length > 0 && <Toast tone="amber" glyph="◷" title={waiting.title} sub={waiting.sub} />}
          {card && <TripCardRow card={card} />}
          <ShelfSwitch value={status} onChange={changeShelf} saves={library} />
          {library.length > 0 && <CategoryChips saves={library} status={status} value={cat} onChange={pickCat} />}
          <Shelf saves={library} status={status} cat={cat} here={library.length > 0 ? here : null} name={name} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** Whether the tabs navigator still has Places selected — true under the
 * capture formSheet, false once another tab is chosen. */
function stillShowing(navigation: {
  getState: () => { index: number; routes: readonly { name: string }[] } | undefined;
}): boolean {
  const s = navigation.getState();
  return s ? s.routes[s.index]?.name === "saves" : false;
}

/**
 * The trip card (docs/design/186 phone `.tcard`): bold title · mono when, the
 * ended trip's line under it (amber while stays wait for "How was it?"), and
 * the tab it opens on. The trip screen picks that tab itself.
 */
function TripCardRow({ card }: { card: TripCard }) {
  const router = useRouter();
  const { title, when, line, amber, cta } = tripCardLines(card);
  return (
    <Pressable
      onPress={() => router.push(`/trips/${card.tripId}`)}
      accessibilityRole="link"
      accessibilityLabel={`${title}, ${when}. ${cta}`}
      style={styles.card}
    >
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {title} · <Text style={styles.cardWhen}>{when}</Text>
        </Text>
        {line !== null && (
          <Text style={[styles.cardLine, { color: amber ? C.warning : C.inkMuted }]} numberOfLines={1}>
            {line}
          </Text>
        )}
      </View>
      <Text style={styles.cardGo}>{cta}</Text>
    </Pressable>
  );
}

/** The wireframe's `.seg`: two full-width halves, the chosen one on navy-soft. */
function ShelfSwitch({
  value,
  onChange,
  saves,
}: {
  value: SavedPlaceStatus;
  onChange: (s: SavedPlaceStatus) => void;
  saves: SavedPlace[];
}) {
  const counts = shelfCounts(saves);
  const options: { value: SavedPlaceStatus; label: string }[] = [
    { value: "want", label: "Want to go" },
    { value: "been", label: "Been there" },
  ];
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segHalf, on && styles.segOn]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>
              {o.label}
              <Text style={styles.segCount}> {counts[o.value]}</Text>
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The location chip (docs/design/186 phone `.loc`): "Near <name>" with a green
 * pin once a fix is known, else a dashed "Set location" that asks on tap.
 */
function LocationChip({ here, name, onAsk }: { here: LatLng | null; name: string | null; onAsk: () => void }) {
  return (
    <Pressable
      onPress={here ? undefined : onAsk}
      disabled={!!here}
      accessibilityRole="button"
      hitSlop={6}
      style={[styles.loc, !here && styles.locOff]}
    >
      <Text style={[styles.locGlyph, { color: here ? C.green : C.inkFaded }]}>⌖</Text>
      <Text style={[styles.locText, { color: here ? C.ink : C.inkFaded }]}>
        {here ? (name ? `Near ${name}` : "Near you") : "Set location"}
      </Text>
    </Pressable>
  );
}

/** All · Stay · Eat · Do with the active shelf's counts (q3 A). */
function CategoryChips({
  saves,
  status,
  value,
  onChange,
}: {
  saves: SavedPlace[];
  status: SavedPlaceStatus;
  value: PlacesCategory;
  onChange: (c: PlacesCategory) => void;
}) {
  return (
    <View style={styles.chips}>
      {PLACES_CATEGORIES.map((c) => (
        <FilterChip
          key={c}
          label={c}
          type={c === "All" ? undefined : CAT_TYPE[c]}
          count={nearYou(saves, status, null, c).total}
          active={value === c}
          onPress={() => onChange(c)}
        />
      ))}
    </View>
  );
}

/**
 * The shelf as core's `nearYou` splits it. With no fix (`here` null) `rest` is
 * exactly `savesShelves` — today's list, with no Near you heading.
 */
function Shelf({
  saves,
  status,
  cat,
  here,
  name,
}: {
  saves: SavedPlace[];
  status: SavedPlaceStatus;
  cat: PlacesCategory;
  here: LatLng | null;
  name: string | null;
}) {
  const { near, rest, total } = nearYou(saves, status, here, cat);
  // An empty library keeps the shipped (empty) list: no chips, no Near you.
  if (saves.length === 0) return null;
  if (total === 0 && cat !== "All") return <Text style={styles.plain}>{placesCategoryEmpty(cat, status)}</Text>;
  if (total === 0) return null;
  const restCount = rest.unanchored.length + rest.regions.reduce((n, r) => n + r.areas.length, 0);
  return (
    <>
      {here && (
        <>
          <View style={styles.ghead}>
            <Text style={[styles.gheadText, styles.gheadNear]}>Near you</Text>
            <Text style={styles.gheadSub}>{nearYouWithin(null)}</Text>
          </View>
          {near.length > 0 ? (
            <Rows saves={near.map((n) => n.save)} miles={Object.fromEntries(near.map((n) => [n.save.id, `${Math.round(n.mi)} mi`]))} />
          ) : (
            <Text style={styles.plain}>{nearYouNothing(name)}</Text>
          )}
          {restCount > 0 && <Text style={[styles.gheadText, styles.elsewhere]}>Everywhere else</Text>}
        </>
      )}
      <Groups shelves={rest} />
    </>
  );
}

/** The shipped region ▸ area groups, then Unanchored. */
function Groups({ shelves }: { shelves: SavesShelves }) {
  const { regions, unanchored } = shelves;
  return (
    <>
      {regions.map((r) => (
        <Fragment key={r.region ?? "—"}>
          {r.region !== null && <Text style={styles.grp}>{r.region}</Text>}
          {r.areas.map((d) => (
            <Fragment key={d.area.id}>
              <View style={styles.dest}>
                <Text style={styles.destName}>{d.area.name}</Text>
                <Text style={styles.destCount}>{d.saves.length}</Text>
              </View>
              <Rows saves={d.saves} />
            </Fragment>
          ))}
        </Fragment>
      ))}
      {unanchored.length > 0 && (
        <>
          <Text style={styles.grp}>Unanchored</Text>
          <Rows saves={unanchored} />
          <Text style={styles.outside}>
            Unanchored saves have no town within 25 mi. They still{" "}
            <Text style={styles.outsideStrong}>surface on trips by distance</Text>.
          </Text>
        </>
      )}
    </>
  );
}

/** One bordered block of rows, then a suggestion strip for each save that has one. */
function Rows({ saves, miles }: { saves: SavedPlace[]; miles?: Record<string, string> }) {
  return (
    <>
      <View style={styles.rows}>
        {saves.map((s, i) => (
          <View key={s.id} style={[styles.row, i > 0 && styles.rowRule]}>
            <CategoryTile type={s.type} size={26} />
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>
                {s.place.name}
              </Text>
              {s.status === "been" && s.rating ? (
                <Stars value={s.rating} size={10} />
              ) : (
                <Text style={styles.rowLine} numberOfLines={1}>
                  {saveRowLine(s)}
                </Text>
              )}
            </View>
            {miles?.[s.id] ? <Text style={styles.mi}>{miles[s.id]}</Text> : null}
          </View>
        ))}
      </View>
      {saves.map((s) => (s.suggestedPlace ? <Suggestion key={`sp_${s.id}`} save={s} /> : null))}
    </>
  );
}

/**
 * Where the phone is, for Near you — without ever prompting on its own.
 * On focus it reads the permission and, only if it is already granted, the
 * last-known fix (no GPS spin-up, works offline). `ask` is the chip's tap: the
 * one place this tab requests permission.
 */
function useHere(): { here: LatLng | null; ask: () => Promise<void> } {
  const [here, setHere] = useState<LatLng | null>(null);
  const take = (p: Location.LocationObject | null) => {
    if (p) setHere({ lat: p.coords.latitude, lng: p.coords.longitude });
  };
  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== "granted") {
            if (live) setHere(null);
            return;
          }
          const p = await Location.getLastKnownPositionAsync();
          if (live) take(p);
        } catch {
          // Location unavailable reads as "Set location", never as an error.
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );
  const ask = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      // A fresh install has no cached fix; the tap is consent to take one.
      take((await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({})));
    } catch {
      // Denied or unavailable: the chip stays "Set location".
    }
  }, []);
  return { here, ask };
}

/** The locality a fix resolves to ("Boise"), or null — asked only when no near save names one. */
function useResolvedName(at: LatLng | null): string | null {
  const [name, setName] = useState<string | null>(null);
  const lat = at?.lat;
  const lng = at?.lng;
  useEffect(() => {
    if (lat == null || lng == null) return;
    let live = true;
    api.areas
      .resolve({ lat, lng })
      .then((d) => {
        if (live) setName(d?.name ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per ~100 m move, not on every jitter.
  }, [lat == null ? null : lat.toFixed(3), lng == null ? null : lng.toFixed(3)]); // eslint-disable-line react-hooks/exhaustive-deps
  return name;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surfaceAlt },
  nav: {
    backgroundColor: C.navy,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { color: C.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.4, fontFamily: F.sans, flex: 1 },
  // docs/design/186 phone `.phead .tr` + `.loc`
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  loc: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  locOff: { borderStyle: "dashed" },
  locGlyph: { fontSize: 12 },
  locText: { fontSize: 11, fontWeight: "700" },
  // .tcard (+ .tt b / .tt b .mono / .tt span / .go)
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.card,
    paddingVertical: 9,
    paddingHorizontal: 11,
    // shadow-rv-sm: 0 1px 2px rgba(0,0,0,.28) (packages/ui/styles/entry.css)
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardText: { flex: 1, minWidth: 0, gap: 1 },
  cardTitle: { fontSize: 13, lineHeight: 17, fontWeight: "700", color: C.ink },
  cardWhen: { fontFamily: F.mono, fontSize: 11.5, fontWeight: "600", color: C.inkMuted },
  cardLine: { fontSize: 11 },
  cardGo: { fontSize: 11, fontWeight: "700", color: C.greenInk },
  // .chips
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  // .ghead / .ghead.near / .ghead .sub
  ghead: { flexDirection: "row", alignItems: "baseline", gap: 6, paddingTop: 6, paddingHorizontal: 2 },
  gheadText: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 0.95,
    color: C.inkFaded,
  },
  gheadNear: { color: C.ink, fontWeight: "700" },
  gheadSub: { marginLeft: "auto", fontFamily: F.mono, fontSize: 9.5, fontWeight: "500", color: C.inkFaded },
  elsewhere: { paddingTop: 10, paddingHorizontal: 2 },
  // .row .mi
  mi: { fontFamily: F.mono, fontSize: 10, color: C.inkMuted },
  // .plain
  plain: {
    fontSize: 11.5,
    color: C.inkMuted,
    padding: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.borderHi,
    borderRadius: R.card,
    textAlign: "center",
  },
  content: { padding: 12, gap: 6 },
  // .seg
  seg: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.card,
    overflow: "hidden",
  },
  segHalf: { flex: 1, alignItems: "center", paddingVertical: 6, paddingHorizontal: 4 },
  segOn: { backgroundColor: C.navySoft },
  segText: { fontSize: 12, color: C.inkMuted },
  segTextOn: { color: C.ink, fontWeight: "700" },
  segCount: { fontFamily: F.mono, fontSize: 10, fontWeight: "400", color: C.inkFaded },
  // .grp
  grp: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 0.95,
    color: C.inkFaded,
    paddingTop: 6,
    paddingHorizontal: 2,
  },
  // .dest
  dest: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: 6,
    paddingHorizontal: 2,
  },
  destName: { fontSize: 13.5, fontWeight: "700", color: C.ink },
  destCount: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
  // .rows / .row
  rows: { borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  row: {
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: C.surface,
  },
  rowRule: { borderTopWidth: 1, borderTopColor: C.borderSoft },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 13, fontWeight: "700", color: C.ink, lineHeight: 16 },
  rowLine: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
  // .outside
  outside: {
    fontSize: 11.5,
    color: C.inkFaded,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.borderHi,
    borderRadius: R.card,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  outsideStrong: { color: C.inkMuted, fontWeight: "700" },
});
