import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IdeaCategory, NearbySave, NearbySaves, ReservationType, SurfaceRadiusMi, Trip } from "@rv-trip/core";
import {
  IDEAS_EMPTY_COPY,
  SURFACE_RADII,
  addAllLabel,
  ideasHeading,
  nearbyBanner,
  nearbyBeyondLine,
  nearbyCountLabel,
  nearbyRowLine,
  shelfIdeas,
} from "@rv-trip/core";
import { addNearbyIdea, setSurfaceRadius } from "./store";
import { C, F, R } from "./theme";
import { CategoryTile, Chip, Stars } from "./ui";

/**
 * Trip surfacing on the phone (#111 i3 · docs/design/111 "#102 · trip
 * surfacing", Q6 A · Q7 B): the rv-info banner and the compact Ideas section
 * at the top of the Route lens, and the "Near this trip" review sheet.
 *
 * Every number and string comes from core (`nearbySaves` and its copy
 * helpers); this file is layout over them.
 */

/** The wireframe's `.suggest` banner — the shipped SuggestionBar tint. */
export function NearbyBanner({
  nearby,
  onOpen,
  onDismiss,
}: {
  nearby: NearbySaves;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const copy = nearbyBanner(nearby.items.length, nearby.radiusMi);
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={copy.title} style={styles.suggest}>
      <Text style={styles.suggestGlyph}>✦</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.suggestTitle}>{copy.title}</Text>
        <Text style={styles.suggestSub}>{copy.sub}</Text>
      </View>
      <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={10}>
        <Text style={styles.dismiss}>{copy.dismiss}</Text>
      </Pressable>
    </Pressable>
  );
}

/** The design's idea category → the type a `CategoryTile` draws (Stay/Eat/Do). */
const TILE_TYPE: Record<IdeaCategory, ReservationType> = {
  stay: "campground",
  eat: "dining",
  do: "activity",
};

/** "Ideas · N" — the trip's shelf ideas (`destinationId` null), compact. */
export function IdeasSection({ trip }: { trip: Trip }) {
  const rows = useMemo(() => shelfIdeas(trip), [trip]);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.lbl}>{ideasHeading(rows.length)}</Text>
      {rows.length === 0 ? (
        <Text style={styles.outside}>{IDEAS_EMPTY_COPY}</Text>
      ) : (
        <View style={styles.rows}>
          {rows.map((r, i) => (
            <View key={r.idea.id} style={[styles.row, i > 0 && styles.rowRule]}>
              <CategoryTile type={TILE_TYPE[r.idea.category]} size={26} />
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {r.idea.title}
                </Text>
                {r.distanceMi !== null && (
                  <Text style={styles.rowLine} numberOfLines={1}>
                    {r.distanceMi} mi · {r.nearestDestinationName}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * The review sheet. Rows stay in the open sheet once added (✓ Idea) — the
 * server drops them from the NEXT read (`isAlreadySaved`), so the sheet keeps
 * what it added and merges it with each fresh answer (a radius chip refetches).
 */
export function NearbySheet({
  tripId,
  nearby,
  visible,
  onClose,
}: {
  tripId: string;
  nearby: NearbySaves;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [added, setAdded] = useState<Record<string, NearbySave>>({});
  const [pending, setPending] = useState<Record<string, true>>({});

  // A fresh open starts clean.
  useEffect(() => {
    if (visible) {
      setAdded({});
      setPending({});
    }
  }, [visible]);

  const rows = useMemo(() => {
    const byId = new Map<string, NearbySave>();
    for (const a of Object.values(added)) byId.set(a.saveId, a);
    for (const i of nearby.items) byId.set(i.saveId, i);
    return [...byId.values()].sort((a, b) => a.distanceMi - b.distanceMi);
  }, [added, nearby.items]);
  const toAdd = rows.filter((r) => !added[r.saveId] && !pending[r.saveId]);

  const add = async (item: NearbySave) => {
    setPending((p) => ({ ...p, [item.saveId]: true }));
    try {
      await addNearbyIdea(tripId, item);
      setAdded((a) => ({ ...a, [item.saveId]: item }));
    } catch {
      // The Add button comes back; nothing was written.
    } finally {
      setPending((p) => {
        const { [item.saveId]: _, ...rest } = p;
        return rest;
      });
    }
  };
  // One at a time, so the shelf's sortOrder follows the list.
  const addAll = async () => {
    for (const item of toAdd) await add(item);
  };

  const beyond = nearby.beyond ? nearbyBeyondLine(nearby.beyond, nearby.radiusMi) : null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { top: insets.top }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.headTitle}>Near this trip</Text>
          <Text style={styles.headCount}>{nearbyCountLabel(rows.length)}</Text>
        </View>
        <View style={styles.chips}>
          {SURFACE_RADII.map((r: SurfaceRadiusMi) => (
            <Chip
              key={r}
              on={r === nearby.radiusMi}
              onPress={r === nearby.radiusMi ? undefined : () => void setSurfaceRadius(tripId, r).catch(() => {})}
            >
              {r} mi
            </Chip>
          ))}
        </View>
        <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: insets.bottom + 8 }}>
          {rows.length > 0 && (
            <View style={styles.rows}>
              {rows.map((item, i) => {
                const done = !!added[item.saveId];
                return (
                  <View key={item.saveId} style={[styles.row, i > 0 && styles.rowRule]}>
                    <CategoryTile type={item.type} size={26} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={styles.rowLineBox}>
                        <Text style={styles.rowLine} numberOfLines={1}>
                          {nearbyRowLine(item)}
                        </Text>
                        {item.status === "been" && item.rating ? <Stars value={item.rating} size={10} /> : null}
                      </View>
                    </View>
                    <Pressable
                      onPress={done ? undefined : () => void add(item)}
                      disabled={done || !!pending[item.saveId]}
                      accessibilityRole="button"
                      hitSlop={6}
                      style={[styles.addbtn, done && styles.addbtnDone, pending[item.saveId] && { opacity: 0.5 }]}
                    >
                      <Text style={[styles.addbtnText, done && styles.addbtnTextDone]}>{done ? "✓ Idea" : "Add"}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
          {beyond && (
            <Text style={styles.outside}>
              <Text style={styles.outsideStrong}>{beyond.lead}</Text>
              {beyond.rest}
            </Text>
          )}
          {toAdd.length > 0 && (
            <Pressable onPress={() => void addAll()} accessibilityRole="button" style={styles.ghost}>
              <Text style={styles.ghostText}>{addAllLabel(toAdd.length)}</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // .suggest
  suggest: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.info,
    backgroundColor: C.infoSoft,
    borderRadius: R.card,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  // rv-info-ink resolves to rv-info in the night palette the phone mirrors.
  suggestGlyph: { color: C.info, fontSize: 15 },
  suggestTitle: { fontSize: 13, fontWeight: "700", color: C.ink },
  suggestSub: { fontSize: 11.5, color: C.inkMuted },
  dismiss: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
  // .lbl
  lbl: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 0.76,
    color: C.inkFaded,
    paddingTop: 4,
  },
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
  rowLineBox: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowLine: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded, flexShrink: 1 },
  // .addbtn — green-cta resolves to rv-green in the palette the phone mirrors.
  addbtn: {
    borderRadius: R.md,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: C.green,
    borderWidth: 1,
    borderColor: C.green,
  },
  addbtnDone: { backgroundColor: "transparent" },
  addbtnText: { fontSize: 11, fontWeight: "800", color: C.navy },
  addbtnTextDone: { color: C.greenInk },
  // .dim / .sheet.full / .grab
  dim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: C.navy, opacity: 0.55 },
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
    paddingTop: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: R.pill,
    backgroundColor: C.borderHi,
    alignSelf: "center",
    marginBottom: 4,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  headTitle: { fontSize: 15, fontWeight: "700", color: C.ink },
  headCount: { fontFamily: F.mono, fontSize: 10.5, color: C.inkFaded },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  // .ghost
  ghost: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: R.card,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.borderHi,
  },
  ghostText: { color: C.inkMuted, fontWeight: "700", fontSize: 12.5 },
});
