import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import type { SavedPlace, SavedPlaceStatus } from "@rv-trip/core";
import { queuedToast, saveRowLine, savesShelves, shelfCounts, suggestionStrip } from "@rv-trip/core";
import { API_URL } from "../../src/api";
import { useCaptureState } from "../../src/capture";
import { patchSave, useSaves } from "../../src/store";
import { C, F, R } from "../../src/theme";
import { Button, CategoryTile, Centered, Kicker, Muted, Stars, Toast } from "../../src/ui";

/**
 * The Saves tab (#111 i2 · docs/design/111 "The Saves tab", Q4 B · Q5 A).
 *
 * Want to go / Been there, then the shelf as core's `savesShelves` groups it:
 * region headers by save count, areas alphabetically under each, saves
 * newest first, and the Unanchored group last. A save with a pending place
 * suggestion (Q3 A) gets the rv-info strip — tap it to upgrade, or Dismiss.
 *
 * While captures are waiting for signal the amber queue line (i1) sits on top.
 */
export default function SavesTab() {
  const { queue } = useCaptureState();
  const { saves, error, reload } = useSaves();
  const [status, setStatus] = useState<SavedPlaceStatus>("want");
  const [refreshing, setRefreshing] = useState(false);

  // Fresh on every visit: a capture made from another tab lands here.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
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
        <Text style={styles.title}>Saves</Text>
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
          <ShelfSwitch value={status} onChange={setStatus} saves={saves ?? []} />
          <Shelf saves={saves ?? []} status={status} />
        </ScrollView>
      )}
    </SafeAreaView>
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

function Shelf({ saves, status }: { saves: SavedPlace[]; status: SavedPlaceStatus }) {
  const { regions, unanchored } = savesShelves(saves, status);
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
function Rows({ saves }: { saves: SavedPlace[] }) {
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
          </View>
        ))}
      </View>
      {saves.map((s) => (s.suggestedPlace ? <Suggestion key={`sp_${s.id}`} save={s} /> : null))}
    </>
  );
}

/** The Q3 A strip: "Did you mean El Chandelier?". Tap upgrades; Dismiss clears. */
function Suggestion({ save }: { save: SavedPlace }) {
  const copy = suggestionStrip(save.suggestedPlace!);
  return (
    <Pressable
      onPress={() => void patchSave(save.id, { upgradeToSuggested: true }).catch(() => {})}
      accessibilityRole="button"
      accessibilityLabel={copy.title}
      style={styles.suggest}
    >
      <Text style={styles.suggestGlyph}>✦</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.suggestTitle} numberOfLines={1}>
          {copy.title}
        </Text>
        {copy.sub ? (
          <Text style={styles.suggestSub} numberOfLines={1}>
            {copy.sub}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => void patchSave(save.id, { suggestedPlace: null }).catch(() => {})}
        accessibilityRole="button"
        hitSlop={10}
      >
        <Text style={styles.dismiss}>{copy.dismiss}</Text>
      </Pressable>
    </Pressable>
  );
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
  title: { color: C.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.4, fontFamily: F.sans },
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
  // .suggest
  suggest: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.info,
    backgroundColor: C.infoSoft,
    borderRadius: R.card,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  // rv-info-ink resolves to rv-info in the night palette the phone mirrors.
  suggestGlyph: { color: C.info, fontSize: 13 },
  suggestTitle: { fontSize: 12, fontWeight: "700", color: C.ink },
  suggestSub: { fontSize: 10.5, color: C.inkMuted },
  dismiss: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
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
