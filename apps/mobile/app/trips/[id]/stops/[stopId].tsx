import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Idea, Reservation } from "@rv-trip/core";
import {
  cycleIdeaStatus,
  dateRange,
  ideaStatusColor,
  isScheduled,
  resDates,
  scheduledOrder,
  setStopNote,
  setStopRating,
  stopMap,
  tripStopPins,
} from "@rv-trip/core";
import { api } from "../../../../src/api";
import { MapFrame, TripMap, useStyleMode } from "../../../../src/map";
import { updateTrip, useBundle } from "../../../../src/store";
import { C, F, R } from "../../../../src/theme";
import { Card, CategoryTile, Centered, Kicker, Muted, Stars } from "../../../../src/ui";

/** The height packages/ui's `MapPlaceholder` has always reserved, and the web's
 * `STOP_MINI_MAP_HEIGHT` (apps/web/src/components/map/StopMiniMap.tsx:13). */
const MINI_MAP_HEIGHT = 150;

const failed = (what: string) => Alert.alert("Didn’t save", `${what} — check your connection and try again.`);

export default function StopScreen() {
  const { id, stopId } = useLocalSearchParams<{ id: string; stopId: string }>();
  const { bundle } = useBundle(id);
  const stop = useMemo(() => (bundle ? (stopMap(bundle.trip).get(stopId) ?? null) : null), [bundle, stopId]);
  const legName = bundle && stop ? (bundle.trip.legs.find((l) => l.id === stop.legId)?.title ?? "") : "";
  const [mode] = useStyleMode();

  /**
   * The kicker's ordinal — "Oregon Coast · stop 2 of 3". Both numbers come from
   * core's `scheduledOrder` (the trip-wide sequence by arrival date, the same
   * one the rail and the map's discs count), NOT from anything local: the web's
   * equivalent is built inside `TripPlanner` and was never reachable here.
   * A floating stop has no position in the sequence, so it keeps the bare leg
   * name.
   */
  const order = useMemo(() => (bundle ? scheduledOrder(bundle.trip) : null), [bundle]);
  const ordinal = order?.ordinals.get(stopId) ?? null;
  const kicker =
    ordinal !== null && legName ? `${legName} · stop ${ordinal} of ${order!.total}` : legName;

  /** The one pin the mini-map places, from the same pure derivation the trip
   * map uses — so the disc's number here and there cannot disagree. */
  const pin = useMemo(
    () => (bundle ? (tripStopPins(bundle.trip).find((p) => p.id === stopId) ?? null) : null),
    [bundle, stopId],
  );
  // A stable array: the camera re-fits on a new `bounds`, so a fresh `[pin]`
  // every render would re-frame the map on every keystroke in the note field.
  const miniPins = useMemo(() => (pin ? [pin] : []), [pin]);

  // The note is edited locally and persisted on blur, like the web sheet.
  const [note, setNote] = useState("");
  useEffect(() => {
    if (stop) setNote(stop.notes ?? "");
  }, [stop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bundle || !stop) {
    return (
      <Centered>
        {bundle ? <Muted>This stop isn’t on the trip any more.</Muted> : <ActivityIndicator color={C.green} />}
      </Centered>
    );
  }

  const scheduled = isScheduled(stop);
  const costTotal = stop.reservations.reduce((a, r) => a + (r.cost ?? 0), 0);

  const rate = (n: number) => {
    updateTrip(id, (t) => setStopRating(t, stop.id, n));
    api.stops.patch(stop.id, { rating: n === 0 ? null : n }).catch(() => failed("Your rating"));
  };
  const commitNote = () => {
    if (note === (stop.notes ?? "")) return;
    updateTrip(id, (t) => setStopNote(t, stop.id, note));
    api.stops.patch(stop.id, { notes: note }).catch(() => failed("Your note"));
  };
  const cycle = (idea: Idea) => {
    updateTrip(id, (t) => cycleIdeaStatus(t, stop.id, idea.id));
    const order: Idea["status"][] = ["idea", "planned", "done"];
    const next = order[(order.indexOf(idea.status) + 1) % 3]!;
    api.ideas.patch(idea.id, { status: next }).catch(() => failed("That idea"));
  };

  return (
    <>
      <Stack.Screen options={{ title: stop.place.name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Kicker color={C.greenInk}>{kicker}</Kicker>
        <Text style={styles.h1}>{stop.place.name}</Text>
        <Text style={[styles.mono, !scheduled && { color: C.warning }]}>
          {scheduled ? dateRange(stop.arriveDate, stop.departDate) : "Floating — no dates yet"}
        </Text>

        {/* The mini-map: no arcs (the prop is omitted), no labels — the sheet
            names the stop directly above the frame — and no style pill, because
            there is no `onModeChange` to change anything with. It follows the
            device preference for free. A frame carries its own border, so only
            the real canvas is wrapped (the shape MapMount.tsx:83-108 uses). */}
        {mode === null ? (
          <MapFrame state="loading" height={MINI_MAP_HEIGHT} />
        ) : pin === null ? (
          <MapFrame state="empty" count={1} height={MINI_MAP_HEIGHT} />
        ) : (
          <View style={styles.miniMap}>
            <TripMap pins={miniPins} mode={mode} showLabels={false} height={MINI_MAP_HEIGHT} />
          </View>
        )}

        {/* Reservations — what you need at the gate */}
        <Section title="Reservations" count={stop.reservations.length}>
          {stop.reservations.length === 0 ? (
            <Muted>Nothing booked here yet.</Muted>
          ) : (
            stop.reservations.map((r) => <ReservationCard key={r.id} r={r} />)
          )}
          {costTotal > 0 && (
            <Text style={[styles.mono, { textAlign: "right" }]}>
              Stop total <Text style={{ color: C.accent, fontWeight: "700" }}>${costTotal.toLocaleString("en-US")}</Text>
            </Text>
          )}
        </Section>

        {/* Ideas — tap to cycle idea → planned → done */}
        {stop.ideas.length > 0 && (
          <Section title="Ideas" count={stop.ideas.length}>
            {stop.ideas.map((it) => (
              <Pressable key={it.id} onPress={() => cycle(it)} accessibilityRole="button">
                {({ pressed }) => (
                  <View style={[styles.idea, { opacity: pressed ? 0.8 : 1 }]}>
                    <Text style={{ color: ideaStatusColor(it.status), fontSize: 16 }}>
                      {it.status === "done" ? "●" : it.status === "planned" ? "◐" : "○"}
                    </Text>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: C.ink, fontSize: 15, fontWeight: "600" }}>{it.title}</Text>
                      {it.notes ? <Text style={{ color: C.inkMuted, fontSize: 12 }}>{it.notes}</Text> : null}
                    </View>
                    <Text style={[styles.mono, { color: ideaStatusColor(it.status) }]}>{it.status}</Text>
                  </View>
                )}
              </Pressable>
            ))}
            <Muted>Tap an idea to move it along.</Muted>
          </Section>
        )}

        {/* Our take — the memory */}
        <Section title="Our take">
          <Text style={{ color: C.inkFaded, fontSize: 13, marginTop: -6 }}>
            What we loved — the memory that seeds the next trip.
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Stars value={stop.rating ?? 0} size={26} onSet={rate} />
            <Text style={styles.mono}>Tap to rate this stop</Text>
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            onBlur={commitNote}
            multiline
            placeholder="What did you love? What to remember for next time…"
            placeholderTextColor={C.inkSubtle}
            style={styles.notes}
          />
        </Section>
      </ScrollView>
    </>
  );
}

function ReservationCard({ r }: { r: Reservation }) {
  const dates = resDates(r);
  return (
    <Card style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <CategoryTile type={r.type} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: C.ink, fontSize: 15, fontWeight: "700" }}>{r.name}</Text>
        <Text style={styles.mono}>
          {r.type}
          {dates ? ` · ${dates}` : ""}
        </Text>
        {r.confirmationNumber ? (
          <Text style={[styles.mono, { color: C.inkMuted }]}>Conf. {r.confirmationNumber}</Text>
        ) : null}
        {r.notes ? <Text style={{ color: C.inkMuted, fontSize: 12.5 }}>{r.notes}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {r.cost != null && (
          <Text style={{ fontFamily: F.mono, color: C.accent, fontWeight: "700", fontSize: 13 }}>
            ${r.cost.toLocaleString("en-US")}
          </Text>
        )}
        {r.rating ? <Stars value={r.rating} size={11} /> : null}
      </View>
    </Card>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={styles.h2}>{title}</Text>
        {count != null && <Text style={styles.mono}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 8, paddingBottom: 64 },
  h1: { color: C.ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginTop: -4 },
  h2: { color: C.ink, fontSize: 17, fontWeight: "700" },
  mono: { fontFamily: F.mono, color: C.inkFaded, fontSize: 12 },
  miniMap: {
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  idea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notes: {
    minHeight: 96,
    color: C.ink,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
  },
});
