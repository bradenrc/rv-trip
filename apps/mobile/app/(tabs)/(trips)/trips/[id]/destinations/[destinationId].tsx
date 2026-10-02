import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { HowWasIt, Idea, Reservation } from "@rv-trip/core";
import {
  LODGING_KIND_LABEL,
  SHELF_CATEGORY_LABEL,
  checkOffStatus,
  isRateableReservation,
  isStayType,
  saveTypeOfIdeaCategory,
  setIdeaFields,
  setDestinationFields,
  setDestinationReservationFields,
  dateRange,
  isScheduled,
  resDates,
  scheduledOrder,
  setDestinationNote,
  setDestinationRating,
  destinationMap,
  tripDestinationPins,
} from "@rv-trip/core";
import { queuePatch } from "../../../../../../src/capture";
import { AgainPair, HowWasItSheet, LoggedMeta } from "../../../../../../src/journal";
import { MapFrame, TripMap, useStyleMode } from "../../../../../../src/map";
import { isProvisionalIdea, updateTrip, useBundle } from "../../../../../../src/store";
import { StaySheet } from "../../../../../../src/stays";
import { C, F, R } from "../../../../../../src/theme";
import { Button, Card, CategoryTile, Centered, Kicker, Muted, Stars } from "../../../../../../src/ui";

/** The height packages/ui's `MapPlaceholder` has always reserved, and the web's
 * `DESTINATION_MINI_MAP_HEIGHT` (apps/web/src/components/map/DestinationMiniMap.tsx:13). */
const MINI_MAP_HEIGHT = 150;


/** The "How was it?" sheet's target: a checked-off idea (with what it held
 * before the check, for Undo) or a reservation's pill. */
type Rating =
  | { kind: "idea"; id: string; done: boolean; before: HowWasIt & { status: Idea["status"] } }
  | { kind: "reservation"; id: string; done: false; before: HowWasIt };

export default function DestinationScreen() {
  const { id, destinationId } = useLocalSearchParams<{ id: string; destinationId: string }>();
  const { bundle } = useBundle(id);
  const destination = useMemo(() => (bundle ? (destinationMap(bundle.trip).get(destinationId) ?? null) : null), [bundle, destinationId]);
  const chapterName = bundle && destination ? (bundle.trip.chapters.find((l) => l.id === destination.chapterId)?.title ?? "") : "";
  const [mode] = useStyleMode();

  /**
   * The kicker's ordinal — "Oregon Coast · destination 2 of 3". Both numbers come from
   * core's `scheduledOrder` (the trip-wide sequence by arrival date, the same
   * one the rail and the map's discs count), NOT from anything local: the web's
   * equivalent is built inside `TripPlanner` and was never reachable here.
   * A floating destination has no position in the sequence, so it keeps the bare chapter
   * name.
   */
  const order = useMemo(() => (bundle ? scheduledOrder(bundle.trip) : null), [bundle]);
  const ordinal = order?.ordinals.get(destinationId) ?? null;
  const kicker =
    ordinal !== null && chapterName ? `${chapterName} · destination ${ordinal} of ${order!.total}` : chapterName;

  /** The one pin the mini-map places, from the same pure derivation the trip
   * map uses — so the disc's number here and there cannot disagree. */
  const pin = useMemo(
    () => (bundle ? (tripDestinationPins(bundle.trip).find((p) => p.id === destinationId) ?? null) : null),
    [bundle, destinationId],
  );
  // A stable array: the camera re-fits on a new `bounds`, so a fresh `[pin]`
  // every render would re-frame the map on every keystroke in the note field.
  const miniPins = useMemo(() => (pin ? [pin] : []), [pin]);

  // #105 · Add stay — the sheet, opened on the trip's lodging default (Q3 A).
  const [stayOpen, setStayOpen] = useState(false);
  // #143 · Q6 B — the stay row whose Edit stay sheet is open.
  const [editingStayId, setEditingStayId] = useState<string | null>(null);

  // #113 · the "How was it?" sheet, when open.
  const [rating, setRating] = useState<Rating | null>(null);

  // The note is edited locally and persisted on blur, like the web sheet.
  const [note, setNote] = useState("");
  useEffect(() => {
    if (destination) setNote(destination.notes ?? "");
  }, [destination?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bundle || !destination) {
    return (
      <Centered>
        {bundle ? <Muted>This destination isn’t on the trip any more.</Muted> : <ActivityIndicator color={C.green} />}
      </Centered>
    );
  }

  const scheduled = isScheduled(destination);
  const editingStay = editingStayId ? (destination.reservations.find((r) => r.id === editingStayId) ?? null) : null;
  const costTotal = destination.reservations.reduce((a, r) => a + (r.cost ?? 0), 0);

  // #113 · Q5 A: every Our-take write goes through the capture queue, so it
  // lands with no signal too; the local store updates straight away and the
  // amber "Saved on this phone" toast replaces the old "Didn't save" alert.
  const rate = (n: number) => {
    updateTrip(id, (t) => setDestinationRating(t, destination.id, n));
    void queuePatch("destination", destination.id, { rating: n === 0 ? null : n });
  };
  const commitNote = () => {
    if (note === (destination.notes ?? "")) return;
    updateTrip(id, (t) => setDestinationNote(t, destination.id, note));
    void queuePatch("destination", destination.id, { notes: note });
  };
  const setAgain = (again: boolean | null) => {
    updateTrip(id, (t) => setDestinationFields(t, destination.id, { again }));
    void queuePatch("destination", destination.id, { again });
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
          updateTrip(id, (t) => setDestinationReservationFields(t, target.id, target.before));
          void queuePatch("reservation", target.id, target.before);
        }
      },
    };
    if (target.kind === "idea") {
      updateTrip(id, (t) => setIdeaFields(t, target.id, v));
      void queuePatch("idea", target.id, v, journal);
    } else {
      updateTrip(id, (t) => setDestinationReservationFields(t, target.id, v));
      void queuePatch("reservation", target.id, v, journal);
    }
  };
  const ratingName =
    rating?.kind === "idea"
      ? (destination.ideas.find((i) => i.id === rating.id)?.title ?? "")
      : rating
        ? (destination.reservations.find((r) => r.id === rating.id)?.name ?? "")
        : "";

  return (
    <>
      <Stack.Screen options={{ title: destination.place.name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Kicker color={C.greenInk}>{kicker}</Kicker>
        <Text style={styles.h1}>{destination.place.name}</Text>
        <Text style={[styles.mono, !scheduled && { color: C.warning }]}>
          {scheduled ? dateRange(destination.arriveDate, destination.departDate) : "Floating — no dates yet"}
        </Text>

        {/* The mini-map: no arcs (the prop is omitted), no labels — the sheet
            names the destination directly above the frame — and no style pill, because
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
        <Section title="Reservations" count={destination.reservations.length}>
          {destination.reservations.length === 0 ? (
            <Muted>Nothing booked here yet.</Muted>
          ) : (
            destination.reservations.map((r) => (
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
                onEdit={() => setEditingStayId(r.id)}
              />
            ))
          )}
          <Button tone="ghost" onPress={() => setStayOpen(true)}>
            Add stay
          </Button>
          {costTotal > 0 && (
            <Text style={[styles.mono, { textAlign: "right" }]}>
              Destination total <Text style={{ color: C.accent, fontWeight: "700" }}>${costTotal.toLocaleString("en-US")}</Text>
            </Text>
          )}
        </Section>

        {/* Ideas — #113 · a check circle: tap ○ when you've done it (Q3 B).
            The whole row is the tap target, at least 44pt tall. */}
        {destination.ideas.length > 0 && (
          <Section title="Ideas" count={destination.ideas.length} hint="tap ○ when you’ve done it">
            {destination.ideas.map((it) => {
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
            <Stars value={destination.rating ?? 0} size={26} onSet={rate} />
            <Text style={styles.mono}>Tap to rate this destination</Text>
          </View>
          {/* #113 · Q2 A — the Again / Once was enough pair. */}
          <AgainPair value={destination.again} onChange={setAgain} />
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
      {(stayOpen || editingStay) && (
        <StaySheet
          key={editingStay?.id ?? "add"}
          tripId={id}
          destinationId={destination.id}
          title={`${destination.place.name}${scheduled ? ` · ${dateRange(destination.arriveDate, destination.departDate)}` : ""}`}
          kind={bundle.trip.lodgingDefault}
          span={scheduled ? { start: destination.arriveDate!, end: destination.departDate! } : null}
          tripSpan={{ start: bundle.trip.startDate, end: bundle.trip.endDate }}
          editing={editingStay}
          onClose={() => {
            setStayOpen(false);
            setEditingStayId(null);
          }}
        />
      )}
    </>
  );
}

/**
 * A Reservations row. #143 · Q6 B — a STAY row (campground or lodging) is the
 * tap target for Edit stay, with a trailing ›; "How was it?" keeps its own
 * inner target. Other rows have no phone form, so they don't change.
 */
function ReservationCard({ r, onRate, onEdit }: { r: Reservation; onRate: () => void; onEdit: () => void }) {
  if (!isStayType(r.type)) return <ReservationCardBody r={r} onRate={onRate} />;
  return (
    <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit stay ${r.name}`}>
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.8 : 1 }}>
          <ReservationCardBody r={r} onRate={onRate} chevron />
        </View>
      )}
    </Pressable>
  );
}

function ReservationCardBody({ r, onRate, chevron = false }: { r: Reservation; onRate: () => void; chevron?: boolean }) {
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
      {chevron && <Text style={styles.chev}>›</Text>}
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
  chev: { fontFamily: F.mono, color: C.inkFaded, fontSize: 14, alignSelf: "center" },
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
