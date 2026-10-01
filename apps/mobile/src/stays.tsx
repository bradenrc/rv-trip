import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { LodgingKind, Reservation, ReservationDraft } from "@rv-trip/core";
import {
  LODGING_KIND_LABEL,
  STAY_KINDS,
  reservationDraft,
  reservationDraftInput,
  reservationDraftPatch,
  stayDraft,
  stayNameLabel,
  withStayKind,
} from "@rv-trip/core";
import { Input, Label, Sheet, failed } from "./hops";
import { addStay, deleteStay, editStay } from "./store";
import { C, F } from "./theme";
import { Button, RangePicker, Segmented } from "./ui";

const KIND_OPTIONS = STAY_KINDS.map((k) => ({ value: k, label: LODGING_KIND_LABEL[k] }));

/**
 * The stop screen's stay form (#105 · Q9 A), kind first. Friends asks only who
 * you're staying with and the nights — no cost, no confirmation number.
 *
 * #143 · Q6 B — given `editing`, the same sheet is **Edit stay**: seeded by
 * core's `reservationDraft(r)`, saved with `reservationDraftPatch` (only what
 * changed; the kind switch is how a stay misfiled before #144 gets fixed), and
 * an amber **Delete stay** under Save behind an "Are you sure?" (Q7 A). Add
 * sends `reservationDraftInput`, the body the web form sends.
 */
export function StaySheet({
  tripId,
  stopId,
  title,
  kind,
  span,
  tripSpan,
  editing = null,
  onClose,
}: {
  tripId: string;
  stopId: string;
  /** "Bend, OR · Aug 12–16" — the stop the stay belongs to. */
  title: string;
  /** Add's opening kind: the trip's lodging default (#105 · Q3 A). */
  kind: LodgingKind | null;
  /** #128 · the stop's own dates — a new stay's default. */
  span: { start: string; end: string } | null;
  tripSpan: { start: string; end: string };
  /** #143 — the stay row being edited; absent/null is Add stay. */
  editing?: Reservation | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ReservationDraft>(() =>
    editing
      ? reservationDraft(editing)
      : { ...stayDraft(kind), checkIn: span?.start ?? "", checkOut: span?.end ?? "" },
  );
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ReservationDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const current = draft.lodgingKind ?? "campground";
  const friends = current === "friends";
  const body = reservationDraftInput(stopId, draft);
  const patch = editing ? reservationDraftPatch(editing, draft) : null;
  const savable = editing ? patch !== null : body !== null;

  const save = async () => {
    if (!savable || saving) return;
    setSaving(true);
    try {
      if (editing) await editStay(tripId, stopId, editing.id, patch!);
      else await addStay(tripId, body!);
      onClose();
    } catch {
      setSaving(false);
      failed("That stay");
    }
  };

  const remove = () => {
    if (!editing) return;
    Alert.alert("Are you sure?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete stay",
        style: "destructive",
        onPress: () => {
          onClose();
          deleteStay(tripId, stopId, editing.id).catch(() => failed("That stay"));
        },
      },
    ]);
  };

  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.st}>{editing ? "Edit stay" : "Add stay"}</Text>
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
            <Input
              mono
              value={draft.confirmationNumber}
              onChangeText={(confirmationNumber) => set({ confirmationNumber })}
              placeholder="optional"
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Label>Cost $</Label>
            <Input mono value={draft.cost} onChangeText={(cost) => set({ cost })} placeholder="0" keyboardType="decimal-pad" />
          </View>
        </View>
      )}
      <Button onPress={() => void save()} disabled={!savable || saving}>
        Save
      </Button>
      {editing && (
        <Button tone="warn" onPress={remove} disabled={saving}>
          Delete stay
        </Button>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  st: { fontSize: 16, fontWeight: "800", color: C.ink },
  mono: { fontFamily: F.mono, color: C.inkFaded, fontSize: 12 },
});
