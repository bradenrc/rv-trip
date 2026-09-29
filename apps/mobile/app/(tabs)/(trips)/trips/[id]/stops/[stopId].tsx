import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { HowWasIt, Idea, LodgingKind, Reservation, ReservationDraft } from "@rv-trip/core";
import {
  LODGING_KIND_LABEL,
  SHELF_CATEGORY_LABEL,
  STAY_KINDS,
  checkOffStatus,
  isRateableReservation,
  reservationDraftInput,
  saveTypeOfIdeaCategory,
  setIdeaFields,
  setStopFields,
  setStopReservationFields,
  stayDraft,
  stayNameLabel,
  withStayKind,
  dateRange,
  isScheduled,
  resDates,
  scheduledOrder,
  setStopNote,
  setStopRating,
  stopMap,
  tripStopPins,
} from "@rv-trip/core";
import { queuePatch } from "../../../../../../src/capture";
import { AgainPair, HowWasItSheet, LoggedMeta } from "../../../../../../src/journal";
import { MapFrame, TripMap, useStyleMode } from "../../../../../../src/map";
import { addStay, isProvisionalIdea, updateTrip, useBundle } from "../../../../../../src/store";
import { C, F, R } from "../../../../../../src/theme";
import { Input, Label, Sheet } from "../../../../../../src/hops";
import { Button, Card, CategoryTile, Centered, Kicker, Muted, RangePicker, Segmented, Stars } from "../../../../../../src/ui";

/** The height packages/ui's `MapPlaceholder` has always reserved, and the web's
 * `STOP_MINI_MAP_HEIGHT` (apps/web/src/components/map/StopMiniMap.tsx:13). */
const MINI_MAP_HEIGHT = 150;

const failed = (what: string) => Alert.alert("Didn’t save", `${what} — check your connection and try again.`);

/** The "How was it?" sheet's target: a checked-off idea (with what it held
 * before the check, for Undo) or a reservation's pill. */
type Rating =
  | { kind: "idea"; id: string; done: boolean; before: HowWasIt & { status: Idea["status"] } }
  | { kind: "reservation"; id: string; done: false; before: HowWasIt };

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

  // #105 · Add stay — the sheet, opened on the trip's lodging default (Q3 A).
  const [stayOpen, setStayOpen] = useState(false);

  // #113 · the "How was it?" sheet, when open.
  const [rating, setRating] = useState<Rating | null>(null);

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

  // #113 · Q5 A: every Our-take write goes through the capture queue, so it
  // lands with no signal too; the local store updates straight away and the
  // amber "Saved on this phone" toast replaces the old "Didn't save" alert.
  const rate = (n: number) => {
    updateTrip(id, (t) => setStopRating(t, stop.id, n));
    void queuePatch("stop", stop.id, { rating: n === 0 ? null : n });
  };
  const commitNote = () => {
    if (note === (stop.notes ?? "")) return;
    updateTrip(id, (t) => setStopNote(t, stop.id, note));
    void queuePatch("stop", stop.id, { notes: note });
  };
  const setAgain = (again: boolean | null) => {
    updateTrip(id, (t) => setStopFields(t, stop.id, { again }));
    void queuePatch("stop", stop.id, { again });
  };

  /** The check circle (Q3 B): one tap commits done and opens the optional
   * sheet; tapping a done idea un-checks it back to `idea`. */
  const check = (idea: Idea) => {
    const status = checkOffStatus(idea.status);
    updateTrip(id, (t) => setIdeaFields(t, idea.id, { status }));
    void queuePatch("idea", idea.id, { status });
    if (status === "done") {
      setRating({
        kind: "idea",
        id: idea.id,
        done: true,
        before: { status: idea.status, rating: idea.rating, again: idea.again, notes: idea.notes },
      });
    }
  };

  /** "✓ Log it": the sheet's three fields, then the green toast whose Undo
   * puts the thing back the way it was before the check (or the pill). */
  const log = (target: Rating, v: HowWasIt) => {
    setRating(null);
    const journal = {
      tripTitle: bundle.trip.title,
      undo: () => {
        if (target.kind === "idea") {
          updateTrip(id, (t) => setIdeaFields(t, target.id, target.before));
          void queuePatch("idea", target.id, target.before);
        } else {
          updateTrip(id, (t) => setStopReservationFields(t, target.id, target.before));
          void queuePatch("reservation", target.id, target.before);
        }
      },
    };
    if (target.kind === "idea") {
      updateTrip(id, (t) => setIdeaFields(t, target.id, v));
      void queuePatch("idea", target.id, v, journal);
    } else {
      updateTrip(id, (t) => setStopReservationFields(t, target.id, v));
      void queuePatch("reservation", target.id, v, journal);
    }
  };
  const ratingName =
    rating?.kind === "idea"
      ? (stop.ideas.find((i) => i.id === rating.id)?.title ?? "")
      : rating
        ? (stop.reservations.find((r) => r.id === rating.id)?.name ?? "")
        : "";

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
            stop.reservations.map((r) => (
              <ReservationCard
                key={r.id}
                r={r}
                onRate={() =>
                  setRating({
                    kind: "reservation",
                    id: r.id,
                    done: false,
                    before: { rating: r.rating, again: r.again, notes: r.notes },
                  })
                }
              />
            ))
          )}
          <Button tone="ghost" onPress={() => setStayOpen(true)}>
            Add stay
          </Button>
          {costTotal > 0 && (
            <Text style={[styles.mono, { textAlign: "right" }]}>
              Stop total <Text style={{ color: C.accent, fontWeight: "700" }}>${costTotal.toLocaleString("en-US")}</Text>
            </Text>
          )}
        </Section>

        {/* Ideas — #113 · a check circle: tap ○ when you've done it (Q3 B).
            The whole row is the tap target, at least 44pt tall. */}
        {stop.ideas.length > 0 && (
          <Section title="Ideas" count={stop.ideas.length} hint="tap ○ when you’ve done it">
            {stop.ideas.map((it) => {
              const done = it.status === "done";
              const logged = it.rating !== null || it.again !== null;
              return (
                <Pressable
                  key={it.id}
                  onPress={() => check(it)}
                  // A Did-it still waiting for signal has no server id to PATCH.
                  disabled={isProvisionalIdea(it)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={it.title}
                >
                  {({ pressed }) => (
                    <View style={[styles.idea, { opacity: pressed ? 0.8 : 1 }]}>
                      <View style={[styles.chk, done && styles.chkDone]}>
                        {done && <Text style={styles.chkMark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: C.ink, fontSize: 15, fontWeight: "600" }}>{it.title}</Text>
                        {logged ? (
                          <LoggedMeta rating={it.rating} again={it.again} />
                        ) : (
                          <Text style={styles.mono}>
                            {it.status} · {SHELF_CATEGORY_LABEL[it.category]}
                          </Text>
                        )}
                        {it.notes ? <Text style={{ color: C.inkMuted, fontSize: 12 }}>{it.notes}</Text> : null}
                      </View>
                      <CategoryTile type={saveTypeOfIdeaCategory(it.category)} size={26} />
                    </View>
                  )}
                </Pressable>
              );
            })}
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
          {/* #113 · Q2 A — the Again / Once was enough pair. */}
          <AgainPair value={stop.again} onChange={setAgain} />
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
      <HowWasItSheet
        visible={rating !== null}
        name={ratingName}
        done={rating?.done ?? false}
        initial={rating?.before ?? { rating: null, again: null, notes: null }}
        onLog={(v) => rating && log(rating, v)}
        // Dismissing counts as Skip: the check has already landed.
        onSkip={() => setRating(null)}
      />
      {stayOpen && (
        <AddStaySheet
          tripId={id}
          stopId={stop.id}
          title={`${stop.place.name}${scheduled ? ` · ${dateRange(stop.arriveDate, stop.departDate)}` : ""}`}
          kind={bundle.trip.lodgingDefault}
          span={scheduled ? { start: stop.arriveDate!, end: stop.departDate! } : null}
          tripSpan={{ start: bundle.trip.startDate, end: bundle.trip.endDate }}
          onClose={() => setStayOpen(false)}
        />
      )}
    </>
  );
}

const KIND_OPTIONS = STAY_KINDS.map((k) => ({ value: k, label: LODGING_KIND_LABEL[k] }));

/**
 * Add stay (#105 · Q9 A): the kind first. Friends asks only who you're staying
 * with and the nights — no cost, no confirmation number. The body is core's
 * `reservationDraftInput`, the same one the web form sends.
 */
function AddStaySheet({
  tripId,
  stopId,
  title,
  kind,
  span,
  tripSpan,
  onClose,
}: {
  tripId: string;
  stopId: string;
  title: string;
  kind: LodgingKind | null;
  /** #128 · the stop's own dates — the stay's default. */
  span: { start: string; end: string } | null;
  tripSpan: { start: string; end: string };
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ReservationDraft>(() => ({
    ...stayDraft(kind),
    checkIn: span?.start ?? "",
    checkOut: span?.end ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ReservationDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const current = draft.lodgingKind ?? "campground";
  const friends = current === "friends";
  const body = reservationDraftInput(stopId, draft);

  const save = async () => {
    if (!body || saving) return;
    setSaving(true);
    try {
      await addStay(tripId, body);
      onClose();
    } catch {
      setSaving(false);
      failed("That stay");
    }
  };

  return (
    <Sheet visible onClose={onClose}>
      <Text style={{ fontSize: 16, fontWeight: "800", color: C.ink }}>Add stay</Text>
      <Text style={styles.mono}>{title}</Text>
      <Segmented value={current} options={KIND_OPTIONS} onChange={(k) => setDraft((d) => withStayKind(d, k))} />
      <Label>{stayNameLabel(current)}</Label>
      <Input value={draft.name} onChangeText={(name) => set({ name })} autoCapitalize="words" />
      {/* #127 · the RangePicker twin in place of the two typed dates. */}
      <Label>{friends ? "Nights" : "Check-in → check-out"}</Label>
      <RangePicker
        value={{ start: draft.checkIn || null, end: draft.checkOut || null }}
        tripSpan={tripSpan}
        onChange={(v) => set({ checkIn: v.start ?? "", checkOut: v.end ?? "" })}
      />
      {friends ? (
        <Text style={styles.mono}>No cost and no confirmation number. It’s their couch.</Text>
      ) : (
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Label>Confirmation #</Label>
            <Input mono value={draft.confirmationNumber} onChangeText={(confirmationNumber) => set({ confirmationNumber })} placeholder="optional" />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Label>Cost $</Label>
            <Input mono value={draft.cost} onChangeText={(cost) => set({ cost })} placeholder="0" keyboardType="decimal-pad" />
          </View>
        </View>
      )}
      <Button onPress={() => void save()} disabled={!body || saving}>
        Save
      </Button>
    </Sheet>
  );
}

function ReservationCard({ r, onRate }: { r: Reservation; onRate: () => void }) {
  const dates = resDates(r);
  return (
    <Card style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <CategoryTile type={r.type} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: C.ink, fontSize: 15, fontWeight: "700" }}>{r.name}</Text>
        <Text style={styles.mono}>
          {/* #105 · a stay prints its kind ("Friends") in place of the type. */}
          {r.lodgingKind ? LODGING_KIND_LABEL[r.lodgingKind] : r.type}
          {dates ? ` · ${dates}` : ""}
        </Text>
        {r.confirmationNumber ? (
          <Text style={[styles.mono, { color: C.inkMuted }]}>Conf. {r.confirmationNumber}</Text>
        ) : null}
        {/* #113 · a logged stay/meal/thing shows its ★ and its Again badge. */}
        <LoggedMeta rating={r.rating} again={r.again} />
        {r.notes ? <Text style={{ color: C.inkMuted, fontSize: 12.5 }}>{r.notes}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {r.cost != null && (
          <Text style={{ fontFamily: F.mono, color: C.accent, fontWeight: "700", fontSize: 13 }}>
            ${r.cost.toLocaleString("en-US")}
          </Text>
        )}
        {/* #113 · a stay, a meal or a thing to do: "How was it?" (never Travel). */}
        {isRateableReservation(r) && (
          <Pressable onPress={onRate} accessibilityRole="button" hitSlop={8} style={styles.ratelink}>
            <Text style={styles.ratelinkText}>How was it?</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  /** #113 · a quiet mono hint on the right of the heading. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={styles.h2}>{title}</Text>
        {count != null && <Text style={styles.mono}>{count}</Text>}
        {hint ? <Text style={[styles.mono, { marginLeft: "auto", fontSize: 10 }]}>{hint}</Text> : null}
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
    alignItems: "flex-start",
    minHeight: 44,
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  // #113 · the check circle — 22pt, border-hi; done fills green with a navy ✓.
  chk: {
    width: 22,
    height: 22,
    borderRadius: R.pill,
    borderWidth: 1.5,
    borderColor: C.borderHi,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  chkDone: { backgroundColor: C.green, borderColor: C.green },
  chkMark: { color: C.navy, fontSize: 13, fontWeight: "800", lineHeight: 15 },
  // docs/design/113 `.ratelink`.
  ratelink: {
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  ratelinkText: { fontFamily: F.mono, fontSize: 9.5, color: C.inkMuted },
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
