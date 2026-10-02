import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  HopBookingDraft,
  Logistics,
  LogisticsGroup,
  LogisticsItem,
  Place,
  Reservation,
  RouteHop,
  ShuttleDraft,
  TravelMode,
  Trip,
  ZoneChip,
} from "@rv-trip/core";
import {
  blankHopDraft,
  fixHopDraftDates,
  hopBookingClash,
  hopBookingInput,
  hopBookingPatch,
  hopClashCopy,
  hopDraftFromBooking,
  hopDraftZones,
  instantToLocal,
  localToInstant,
  shuttleBookingInput,
  shuttleDraftFromBooking,
  shuttleZone,
  zoneChoices,
} from "@rv-trip/core";
import { addHopBooking, deleteHopBooking, editHopBooking, setHopMode } from "./store";
import { C, F, R } from "./theme";
import { Button, CategoryTile, Chip, Kicker, Segmented, type SegmentedOption } from "./ui";

/**
 * The phone's hops (#104 · Q12 C — full parity): the travel card a fly/ferry
 * hop draws on the Route lens, the ⋯ action sheet a drive trip's drive row
 * opens (Q7 B), and the Add flight / Add ferry sheet with the same fields,
 * zone chips and date-clash fixes as the web — run through the same core
 * functions. Menus and forms are bottom sheets on RN `Modal`, the
 * `NearbySheet` precedent. Fly/ferry glyphs are text (✈ ⛴), as on the rhythm
 * strip; date and time fields are mono TextInputs (the app has no picker).
 */

export const MODE_OPTIONS: SegmentedOption<TravelMode>[] = [
  { value: "drive", label: "Drive" },
  { value: "fly", label: "Fly" },
  { value: "ferry", label: "Ferry" },
];

export const modeGlyph = (mode: TravelMode) => (mode === "ferry" ? "⛴" : "✈");

/** The app's one "didn't save" alert: every failed write says so, never silently. */
export const failed = (what: string) => Alert.alert("Didn’t save", `${what} — check your connection and try again.`);

/**
 * Switch a hop. #129 · Q11 A: Fly → Drive on a hop with bookings ASKS —
 * "Keep it, parked" (the flights stay on the hop, back when it flies),
 * "Remove it", or stay as it is. The old refusal is gone.
 */
export function switchHop(trip: Trip, segmentId: string, mode: TravelMode) {
  const seg = trip.segments.find((s) => s.id === segmentId);
  const run = (bookings?: "keep" | "remove") =>
    setHopMode(trip.id, segmentId, mode, bookings).catch(() => failed("That switch"));
  if (!seg || mode !== "drive" || seg.mode === "drive" || seg.reservations.length === 0) {
    void run();
    return;
  }
  const n = seg.reservations.length;
  const noun = seg.mode === "ferry" ? "ferry" : "flight";
  Alert.alert(
    `This hop has ${n} ${noun} booking${n === 1 ? "" : "s"}`,
    `(${seg.reservations.map((r) => r.name).join(" · ")}). Driving doesn’t use ${n === 1 ? "it" : "them"}.`,
    [
      { text: "Keep it, parked", onPress: () => void run("keep") },
      { text: "Remove it", style: "destructive", onPress: () => void run("remove") },
      { text: seg.mode === "ferry" ? "Stay on Ferry" : "Stay on Fly", style: "cancel" },
    ],
  );
}

/** What a booking sheet needs of the hop it books on — a `RouteHop` or a
 * Logistics group (#155) both qualify. */
export type HopRef = Pick<RouteHop, "segmentId" | "mode" | "fromDestinationId" | "toDestinationId" | "fromName" | "toName">;

/**
 * The travel card: 3px rv-travel left rule, the hop's glyph, `from → to` and
 * its switch. #155 · Q3 B — the flights moved to the hop's Logistics group;
 * the card carries the count chip ("2 flights · 1 shuttle → Logistics"), and
 * tapping it scrolls the Route to that group.
 */
export function HopRow({
  hop,
  flush,
  showSwitch,
  onMode,
  onChip,
}: {
  hop: RouteHop;
  flush: boolean;
  showSwitch: boolean;
  onMode: (m: TravelMode) => void;
  /** #155 · the chip — scroll to the hop's Logistics group. */
  onChip?: () => void;
}) {
  // #129 · Q11 A — a hop that DRIVES but kept its flights: the switch inline
  // (on any trip mode) and the parked row; the flights come back if it flies.
  if (hop.parked > 0) {
    return (
      <View style={[styles.phop, flush && { marginLeft: 0 }]}>
        <View style={styles.hh}>
          <Text style={{ color: C.inkMuted, fontSize: 12 }}>🚐</Text>
          <Text style={styles.hhBold}>
            {hop.fromName} → {hop.toName}
          </Text>
          {hop.dayLabel && <Text style={styles.pm}>{hop.dayLabel}</Text>}
        </View>
        <Segmented mono value={hop.mode} options={MODE_OPTIONS} onChange={onMode} />
        <View style={styles.parked}>
          <Text style={styles.pm}>
            ✈ {hop.parked} flight booking{hop.parked === 1 ? "" : "s"} parked — comes back if you fly
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.phop, flush && { marginLeft: 0 }]}>
      <View style={styles.hh}>
        <Text style={{ color: C.inkMuted, fontSize: 12 }}>{modeGlyph(hop.mode)}</Text>
        <Text style={styles.hhBold}>
          {hop.fromName} → {hop.toName}
        </Text>
        {hop.overnight && <Text style={styles.pm}>redeye</Text>}
      </View>
      {showSwitch && <Segmented mono value={hop.mode} options={MODE_OPTIONS} onChange={onMode} />}
      {hop.chip && (
        <Pressable onPress={onChip} disabled={!onChip} accessibilityRole="link" hitSlop={6} style={styles.jump}>
          <Text style={styles.jumpText}>{hop.chip}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The Logistics section (#155 · Q3 B), after the last chapter and "+ Add
 * destination": one group per fly or ferry hop, in segment order — the same
 * `logisticsModel` the web draws. Each group reports its y (relative to the
 * section) so a hop chip can scroll the Route to it.
 */
export function LogisticsSection({
  model,
  onGroupLayout,
  onAdd,
  onAddShuttle,
  onEdit,
}: {
  model: Logistics;
  onGroupLayout?: (segmentId: string, y: number) => void;
  onAdd: (g: LogisticsGroup) => void;
  onAddShuttle: (g: LogisticsGroup) => void;
  onEdit: (g: LogisticsGroup, bookingId: string) => void;
}) {
  return (
    <View style={styles.logi}>
      <Kicker>Logistics</Kicker>
      {model.groups.map((g) => (
        <View
          key={g.segmentId}
          onLayout={(e) => onGroupLayout?.(g.segmentId, e.nativeEvent.layout.y)}
          style={{ gap: 2 }}
        >
          <Text style={styles.lday}>
            {[g.dayLabel, `${g.fromName} → ${g.toName}`].filter(Boolean).join(" · ")}
          </Text>
          {g.items.map((item, i) => (
            <LogisticsRow key={item.kind === "booking" ? item.id : `${item.kind}-${i}`} item={item} onEdit={(id) => onEdit(g, id)} />
          ))}
          <View style={styles.ladd}>
            <Pressable onPress={() => onAdd(g)} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.laddText}>+ {g.mode === "ferry" ? "Add ferry" : "Add flight"}</Text>
            </Pressable>
            <Pressable onPress={() => onAddShuttle(g)} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.laddText}>+ Add shuttle</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function LogisticsRow({ item, onEdit }: { item: LogisticsItem; onEdit: (bookingId: string) => void }) {
  if (item.kind === "layover") return <Text style={styles.lay}>{item.label}</Text>;
  const clock = (
    <Text style={styles.tm}>
      {item.departTime}
      {item.departAbbr ? <Text style={styles.z}> {item.departAbbr}</Text> : null}
      {item.arriveTime ? " → " : ""}
      {item.arriveTime}
      {item.arriveAbbr ? <Text style={styles.z}> {item.arriveAbbr}</Text> : null}
    </Text>
  );
  const timed = item.departTime !== null || item.arriveTime !== null;
  if (item.kind === "empty") {
    return (
      <View style={styles.li}>
        <CategoryTile type="other" size={24} />
        <Text style={[styles.nm, styles.ghost]}>{item.label}</Text>
        {timed && clock}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onEdit(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.transportKind} ${item.name}`}
      style={[styles.li, item.aside && { paddingLeft: 16 }]}
    >
      {/* The phone tile is a two-letter mark, so a flight and a shuttle both
          read "Tr" and differ by name (the Bus icon is web-only). */}
      <CategoryTile type="transport" size={24} />
      <Text style={styles.nm} numberOfLines={1}>
        {item.name}
      </Text>
      {timed && clock}
    </Pressable>
  );
}

/**
 * A bottom sheet on RN Modal — dim, grab handle, surface. The surface sits in
 * a `KeyboardAvoidingView` so a sheet with a TextInput — the How was it?
 * note, the hop booking form, Add stay, Round trip — rides up above the
 * keyboard instead of vanishing behind it (#113 walk FN, #140). iOS uses
 * `padding`; Android uses `height`, because an RN Modal is its own window and
 * the activity's adjustResize never reaches it — without a behavior the IME
 * simply covers the lower fields. The 88% cap and the inner ScrollView keep a
 * long form scrollable once the sheet has shrunk above the keyboard.
 */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView
        style={styles.sheetHost}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 18, maxHeight: "88%" }]}>
          <View style={styles.grab} />
          <ScrollView contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A drive trip's ⋯ on a drive row (Q7 B): the only way PNW flies a hop. */
export function HopActionSheet({
  visible,
  title,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  onPick: (mode: TravelMode) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.pm}>{title}</Text>
      <View style={styles.aslist}>
        <Pressable onPress={() => onPick("fly")} accessibilityRole="button" style={styles.asRow}>
          <Text style={styles.asText}>✈ Fly this hop instead</Text>
        </Pressable>
        <Pressable onPress={() => onPick("ferry")} accessibilityRole="button" style={[styles.asRow, styles.asRule]}>
          <Text style={styles.asText}>⛴ Take a ferry instead</Text>
        </Pressable>
      </View>
      <Button tone="ghost" onPress={onClose}>
        Cancel
      </Button>
    </Sheet>
  );
}

/** "America/Costa_Rica · CST" — the abbreviation in force at the typed time. */
function zoneLabel(zone: string, local: string): string {
  const at = localToInstant(local, zone) ?? new Date().toISOString();
  return `${zone} · ${instantToLocal(at, zone).abbr}`;
}

/**
 * Add flight / Add ferry. The same fields, chips and fixes as the web form:
 * a chip the table verified is green; one it could not is amber and lists the
 * zones when tapped; Save stays disabled until both ends have a zone; a date
 * clash names the destination and offers the two fixes, and nothing saves until one
 * is picked.
 *
 * #143 — given `editing`, the same sheet is **Edit flight / Edit ferry** (the
 * web's #124): seeded by `hopDraftFromBooking`, saved via `hopBookingPatch`,
 * the clash judged against the hop WITHOUT the booking it replaces, and an
 * amber Delete behind "Are you sure?" (Q7 A). The destination move rides the create
 * only, so an edit offers just the date fix.
 */
export function HopBookingSheet({
  trip,
  hop,
  editing = null,
  onClose,
}: {
  trip: Trip;
  hop: HopRef | null;
  /** #143 — the booking being edited (from `trip.segments[].reservations`). */
  editing?: Reservation | null;
  onClose: () => void;
}) {
  const kind = hop?.mode === "ferry" ? "ferry" : "flight";
  const [draft, setDraft] = useState<HopBookingDraft>(() => blankHopDraft(kind));
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh open starts clean, on this hop's ports — or on the booking edited.
  useEffect(() => {
    if (hop) {
      setDraft(
        editing ? hopDraftFromBooking(editing, kind) : blankHopDraft(kind, { from: hop.fromName, to: hop.toName }),
      );
    }
    setPicking(null);
    setSaving(false);
  }, [hop?.segmentId, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ports = useMemo(() => {
    const destinations = trip.chapters.flatMap((l) => l.destinations);
    const of = (id: string | null): Place | null => destinations.find((s) => s.id === id)?.place ?? null;
    return { from: of(hop?.fromDestinationId ?? null), to: of(hop?.toDestinationId ?? null) };
  }, [trip, hop]);

  if (!hop) return null;
  const set = (patch: Partial<HopBookingDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const zones = hopDraftZones(draft, ports);
  const body = hopBookingInput(hop.segmentId, draft, zones);
  // An edit is judged against the hop WITHOUT the booking it replaces.
  const judged = editing
    ? {
        ...trip,
        segments: trip.segments.map((s) =>
          s.id === hop.segmentId ? { ...s, reservations: s.reservations.filter((r) => r.id !== editing.id) } : s,
        ),
      }
    : trip;
  const clash = body ? hopBookingClash(judged, hop.segmentId, body) : null;
  const copy = clash ? hopClashCopy(clash, kind) : null;
  const noun = kind === "ferry" ? "ferry" : "flight";
  const what = kind === "ferry" ? "That ferry" : "That flight";

  const save = async (move: boolean) => {
    if (!body || saving) return;
    setSaving(true);
    try {
      if (editing) {
        await editHopBooking(
          trip.id,
          editing.id,
          hopBookingPatch(editing, {
            name: body.name,
            startsAt: body.startsAt,
            endsAt: body.endsAt,
            startsTz: body.startsTz,
            endsTz: body.endsTz,
          }),
        );
      } else {
        await addHopBooking(trip.id, body, move);
      }
      onClose();
    } catch {
      setSaving(false);
      failed(what);
    }
  };

  const remove = () => {
    if (!editing) return;
    Alert.alert("Are you sure?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: `Delete ${noun}`,
        style: "destructive",
        onPress: () => {
          onClose();
          deleteHopBooking(trip.id, editing.id).catch(() => failed(what));
        },
      },
    ]);
  };

  const chip = (which: "from" | "to", c: ZoneChip, local: string) => (
    <View style={{ alignSelf: "flex-start" }}>
      <Chip on={c.verified} warn={c.zone === null} onPress={() => setPicking(picking === which ? null : which)}>
        {c.zone ? `${c.verified ? "✓ " : ""}${zoneLabel(c.zone, local)}` : `${c.code || "?"}? pick a zone`}
      </Chip>
    </View>
  );

  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.st}>{editing ? `Edit ${noun}` : kind === "ferry" ? "Add ferry" : "Add flight"}</Text>
      <Text style={styles.pm}>
        {hop.fromName} → {hop.toName}
      </Text>

      {kind === "flight" ? (
        <>
          <Label>Flight</Label>
          <Input mono value={draft.label} onChangeText={(label) => set({ label })} placeholder="AA 1190" />
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={{ flex: 1 }}>
              <Label>From</Label>
              <Input mono value={draft.from} onChangeText={(from) => set({ from, fromZone: null })} placeholder="LIR" />
            </View>
            <View style={{ flex: 1 }}>
              <Label>To</Label>
              <Input mono value={draft.to} onChangeText={(to) => set({ to, toZone: null })} placeholder="DFW" />
            </View>
          </View>
        </>
      ) : (
        <>
          <Label>Operator</Label>
          <Input value={draft.label} onChangeText={(label) => set({ label })} />
          <Text style={styles.pm}>
            {draft.from} → {draft.to}
          </Text>
        </>
      )}

      <Label>Departs · local</Label>
      <Input mono value={draft.departs} onChangeText={(departs) => set({ departs })} placeholder="2027-01-24 19:30" />
      {(kind === "ferry" || zones.from.code !== "") && chip("from", zones.from, draft.departs)}
      <Label>Arrives · local</Label>
      <Input mono value={draft.arrives} onChangeText={(arrives) => set({ arrives })} placeholder="2027-01-24 23:55" />
      {(kind === "flight" ? zones.to.code !== "" : zones.to.zone !== zones.from.zone) &&
        chip("to", zones.to, draft.arrives)}

      {picking && (
        <View style={styles.zoneList}>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }}>
            {zoneChoices().map((z) => (
              <Pressable
                key={z}
                onPress={() => {
                  set(picking === "from" ? { fromZone: z } : { toZone: z });
                  setPicking(null);
                }}
                style={styles.zoneRow}
                accessibilityRole="button"
              >
                <Text style={styles.zoneText}>{z}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {clash && copy && (
        <View style={styles.pconf}>
          <Text style={styles.w}>⚠ {copy.headline}</Text>
          <Text style={{ color: C.ink, fontSize: 11.5 }}>{copy.sub}</Text>
          {/* The destination move rides the CREATE only; an edit fixes its date. */}
          {!editing && (
            <Pressable onPress={() => void save(true)} disabled={saving} style={styles.pconfA} accessibilityRole="button">
              <Text style={styles.pconfAText}>{copy.move}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setDraft((d) => fixHopDraftDates(d, clash))}
            style={styles.pconfA}
            accessibilityRole="button"
          >
            <Text style={styles.pconfAText}>{copy.keep}</Text>
          </Pressable>
        </View>
      )}

      <Button onPress={() => void save(false)} disabled={!body || clash !== null || saving}>
        {kind === "ferry" ? "Save ferry" : "Save flight"}
      </Button>
      {editing && (
        <Button tone="warn" onPress={remove} disabled={saving}>
          {`Delete ${noun}`}
        </Button>
      )}
    </Sheet>
  );
}

/**
 * "+ Add shuttle" (#155 · Q4 A) — the booking sheet's sibling: a name
 * (required) and two OPTIONAL local times, read in the hop's zone on the
 * shuttle's side. Writes `transportKind: "shuttle"`; a shuttle never re-times
 * its hop, so there is no date clash to judge. Given `editing`, Edit shuttle.
 */
export function ShuttleSheet({
  trip,
  hop,
  editing = null,
  onClose,
}: {
  trip: Trip;
  hop: HopRef | null;
  editing?: Reservation | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ShuttleDraft>({ name: "", departs: "", arrives: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(editing ? shuttleDraftFromBooking(editing) : { name: "", departs: "", arrives: "" });
    setSaving(false);
  }, [hop?.segmentId, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hop) return null;
  const set = (patch: Partial<ShuttleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const body = shuttleBookingInput(hop.segmentId, draft, shuttleZone(trip, hop.segmentId));
  const noun = editing?.transportKind ?? "shuttle";
  const what = `That ${noun}`;

  const save = async () => {
    if (!body || saving) return;
    setSaving(true);
    try {
      if (editing) {
        await editHopBooking(
          trip.id,
          editing.id,
          hopBookingPatch(editing, {
            name: body.name,
            startsAt: body.startsAt,
            endsAt: body.endsAt,
            startsTz: body.startsTz,
            endsTz: body.endsTz,
          }),
        );
      } else {
        await addHopBooking(trip.id, body, false);
      }
      onClose();
    } catch {
      setSaving(false);
      failed(what);
    }
  };

  const remove = () => {
    if (!editing) return;
    Alert.alert("Are you sure?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: `Delete ${noun}`,
        style: "destructive",
        onPress: () => {
          onClose();
          deleteHopBooking(trip.id, editing.id).catch(() => failed(what));
        },
      },
    ]);
  };

  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.st}>{editing ? `Edit ${noun}` : "Add shuttle"}</Text>
      <Text style={styles.pm}>
        {hop.fromName} → {hop.toName}
      </Text>
      <Label>Name</Label>
      <Input value={draft.name} onChangeText={(name) => set({ name })} placeholder="Airport shuttle" />
      <Label>Departs · local</Label>
      <Input mono value={draft.departs} onChangeText={(departs) => set({ departs })} />
      <Label>Arrives · local</Label>
      <Input mono value={draft.arrives} onChangeText={(arrives) => set({ arrives })} />
      <Button onPress={() => void save()} disabled={!body || saving}>
        {`Save ${noun}`}
      </Button>
      {editing && (
        <Button tone="warn" onPress={remove} disabled={saving}>
          {`Delete ${noun}`}
        </Button>
      )}
    </Sheet>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.fl}>{children}</Text>;
}

export function Input({
  mono = false,
  ...props
}: { mono?: boolean } & React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={C.inkSubtle}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.pin, mono && styles.pinMono]}
    />
  );
}

const styles = StyleSheet.create({
  phop: {
    marginLeft: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.travel,
    borderRadius: R.md,
    backgroundColor: C.surface,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  hh: { flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" },
  hhBold: { color: C.ink, fontWeight: "700", fontSize: 12 },
  // #155 · the hop chip — travel ink, because it names transport bookings.
  jump: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.pill,
    paddingVertical: 1,
    paddingHorizontal: 8,
  },
  // RV has no separate travel-ink: in the dark app both are violet-400.
  jumpText: { fontFamily: F.mono, fontSize: 9.5, color: C.travel },
  // #155 · the Logistics section.
  logi: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginTop: 4, gap: 6 },
  lday: { fontFamily: F.mono, fontSize: 9.5, color: C.inkMuted, marginTop: 6 },
  li: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 5 },
  nm: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: "600", color: C.ink },
  ghost: { color: C.inkFaded, fontWeight: "500" },
  tm: { fontFamily: F.mono, fontSize: 9.5, color: C.inkMuted },
  lay: { fontFamily: F.mono, fontSize: 9.5, color: C.inkFaded, paddingTop: 3, paddingLeft: 32 },
  ladd: { flexDirection: "row", gap: 10, paddingTop: 4, paddingLeft: 32 },
  laddText: { fontSize: 10.5, color: C.ink },
  z: { color: C.inkFaded },
  pm: { fontFamily: F.mono, fontSize: 10.5, color: C.inkFaded },
  st: { fontSize: 16, fontWeight: "800", color: C.ink },
  fl: {
    fontFamily: F.mono,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.72,
    color: C.inkFaded,
  },
  pin: {
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.md,
    backgroundColor: C.navyDeep,
    paddingVertical: 7,
    paddingHorizontal: 9,
    fontSize: 12.5,
    color: C.ink,
  },
  pinMono: { fontFamily: F.mono, fontSize: 11.5 },
  dim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: C.navy, opacity: 0.55 },
  // Fills the modal and bottom-anchors the surface in normal flow, so the
  // KeyboardAvoidingView's padding lifts it; box-none lets taps above it fall
  // through to the dim (dismiss = Skip, unchanged).
  sheetHost: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderColor: C.borderHi,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingHorizontal: 14,
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
  aslist: { borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  asRow: { paddingVertical: 11, paddingHorizontal: 12, backgroundColor: C.surface },
  asRule: { borderTopWidth: 1, borderTopColor: C.borderSoft },
  asText: { fontSize: 14, color: C.ink },
  pconf: {
    borderWidth: 1,
    borderColor: C.warning,
    backgroundColor: C.warningSoft,
    borderRadius: R.card,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  w: { color: C.warning, fontWeight: "700", fontSize: 11.5 },
  pconfA: {
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.md,
    paddingVertical: 6,
    paddingHorizontal: 9,
    backgroundColor: C.surface,
  },
  pconfAText: { fontWeight: "700", fontSize: 12, color: C.ink, textAlign: "center" },
  zoneList: { borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  zoneRow: { paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: C.borderSoft },
  zoneText: { fontFamily: F.mono, fontSize: 11.5, color: C.ink },
  parked: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.borderHi,
    borderRadius: R.md,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  leg: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    paddingVertical: 7,
    paddingHorizontal: 9,
    backgroundColor: C.surface,
    gap: 6,
  },
});

/** Shared with `round-trip.tsx`: the Round trip sheet lives there so it can use
 * itinerary's PlaceSearchField without an import cycle (#142). */
export const sheetStyles = styles;
