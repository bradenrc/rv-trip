import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  HopBookingDraft,
  Place,
  RouteHop,
  RouteHopBooking,
  TravelMode,
  Trip,
  ZoneChip,
} from "@rv-trip/core";
import {
  blankHopDraft,
  fixHopDraftDates,
  hopBookingClash,
  hopBookingInput,
  hopClashCopy,
  hopDraftZones,
  instantToLocal,
  localToInstant,
  zoneChoices,
  boundaryFlightsBody,
  mirrorReturnDraft,
} from "@rv-trip/core";
import { addHopBooking, saveBoundaryFlights, setHopMode } from "./store";
import { C, F, R } from "./theme";
import { Button, Chip, Segmented, type SegmentedOption } from "./ui";

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

const failed = (what: string) => Alert.alert("Didn’t save", `${what} — check your connection and try again.`);

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

/** The travel card: 3px rv-travel left rule, the hop's flights in local time. */
export function HopRow({
  hop,
  flush,
  showSwitch,
  onMode,
  onAdd,
}: {
  hop: RouteHop;
  flush: boolean;
  showSwitch: boolean;
  onMode: (m: TravelMode) => void;
  onAdd: () => void;
}) {
  const bookings = hop.items.filter((i): i is RouteHopBooking => i.kind === "booking");
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
      {bookings.map((b) => (
        <Text key={b.id} style={styles.pfl}>
          {b.name}
          {b.departTime && b.arriveTime ? (
            <>
              {"\n"}
              {b.departTime} <Text style={styles.z}>{b.departAbbr}</Text> → {b.arriveTime}{" "}
              <Text style={styles.z}>{b.arriveAbbr}</Text>
            </>
          ) : null}
        </Text>
      ))}
      <Pressable onPress={onAdd} accessibilityRole="button" hitSlop={6}>
        <Text style={[styles.pm, { color: C.ink }]}>+ {hop.mode === "ferry" ? "Add ferry" : "Add flight"}</Text>
      </Pressable>
    </View>
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
 * clash names the stop and offers the two fixes, and nothing saves until one
 * is picked.
 */
export function HopBookingSheet({
  trip,
  hop,
  onClose,
}: {
  trip: Trip;
  hop: RouteHop | null;
  onClose: () => void;
}) {
  const kind = hop?.mode === "ferry" ? "ferry" : "flight";
  const [draft, setDraft] = useState<HopBookingDraft>(() => blankHopDraft(kind));
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh open starts clean, on this hop's ports.
  useEffect(() => {
    if (hop) setDraft(blankHopDraft(kind, { from: hop.fromName, to: hop.toName }));
    setPicking(null);
    setSaving(false);
  }, [hop?.segmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ports = useMemo(() => {
    const stops = trip.legs.flatMap((l) => l.stops);
    const of = (id: string | null): Place | null => stops.find((s) => s.id === id)?.place ?? null;
    return { from: of(hop?.fromStopId ?? null), to: of(hop?.toStopId ?? null) };
  }, [trip, hop]);

  if (!hop) return null;
  const set = (patch: Partial<HopBookingDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const zones = hopDraftZones(draft, ports);
  const body = hopBookingInput(hop.segmentId, draft, zones);
  const clash = body ? hopBookingClash(trip, hop.segmentId, body) : null;
  const copy = clash ? hopClashCopy(clash, kind) : null;

  const save = async (move: boolean) => {
    if (!body || saving) return;
    setSaving(true);
    try {
      await addHopBooking(trip.id, body, move);
      onClose();
    } catch {
      setSaving(false);
      failed(kind === "ferry" ? "That ferry" : "That flight");
    }
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
      <Text style={styles.st}>{kind === "ferry" ? "Add ferry" : "Add flight"}</Text>
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
          <Pressable onPress={() => void save(true)} disabled={saving} style={styles.pconfA} accessibilityRole="button">
            <Text style={styles.pconfAText}>{copy.move}</Text>
          </Pressable>
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
    </Sheet>
  );
}

/**
 * #129 · Q10 A — Add flight from the trip's + Add: the two boundary hops in one
 * save. Round trip is ON by default; the return opens with the outbound's
 * airports mirrored and the trip's last day. The same core helpers as the web
 * sheet (`boundaryFlightsBody`, `mirrorReturnDraft`).
 */
export function RoundTripSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [roundTrip, setRoundTrip] = useState(true);
  const [out, setOut] = useState<HopBookingDraft>(() => ({
    ...blankHopDraft("flight"),
    departs: `${trip.startDate} `,
    arrives: `${trip.startDate} `,
  }));
  const [back, setBack] = useState<HopBookingDraft>(() => mirrorReturnDraft(out, trip.endDate));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const dest = trip.destination?.name ?? trip.legs.flatMap((l) => l.stops)[0]?.place.name ?? "";

  const setOutbound = (patch: Partial<HopBookingDraft>) => {
    const next = { ...out, ...patch };
    setOut(next);
    if (!touched && ("from" in patch || "to" in patch)) {
      setBack((b) => ({ ...b, from: next.to, to: next.from, fromZone: next.toZone, toZone: next.fromZone }));
    }
  };
  const body = boundaryFlightsBody(roundTrip, out, roundTrip ? back : null);
  const save = async () => {
    if (!body || saving) return;
    setSaving(true);
    try {
      await saveBoundaryFlights(trip.id, body);
      onClose();
    } catch {
      setSaving(false);
      failed(trip.homeBase ? "Those flights" : "Set a home base first — those flights");
    }
  };
  const leg = (title: string, d: HopBookingDraft, set: (p: Partial<HopBookingDraft>) => void, mirror = false) => {
    const zones = hopDraftZones(d);
    return (
      <View style={[styles.leg, mirror && { borderStyle: "dashed" }]}>
        <Label>{title}</Label>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={{ flex: 1.2 }}>
            <Input mono value={d.label} onChangeText={(label) => set({ label })} placeholder="AS 2291" />
          </View>
          <View style={{ flex: 1 }}>
            <Input mono value={d.from} onChangeText={(from) => set({ from, fromZone: null })} placeholder="BOI" />
          </View>
          <View style={{ flex: 1 }}>
            <Input mono value={d.to} onChangeText={(to) => set({ to, toZone: null })} placeholder="BLI" />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={{ flex: 1 }}>
            <Input mono value={d.departs} onChangeText={(departs) => set({ departs })} placeholder="2026-10-10 07:05" />
          </View>
          <View style={{ flex: 1 }}>
            <Input mono value={d.arrives} onChangeText={(arrives) => set({ arrives })} placeholder="2026-10-10 08:10" />
          </View>
        </View>
        {(zones.from.zone === null && zones.from.code !== "") || (zones.to.zone === null && zones.to.code !== "") ? (
          <Text style={[styles.pm, { color: C.warning }]}>An airport we don’t know — add this leg on its hop to pick a zone.</Text>
        ) : null}
      </View>
    );
  };
  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.st}>✈ Add flight</Text>
      <Text style={styles.pm}>Home {roundTrip ? "⇄" : "→"} {dest}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Switch value={roundTrip} onValueChange={setRoundTrip} trackColor={{ true: C.green, false: C.borderHi }} />
        <Text style={{ color: C.ink, fontWeight: "700", fontSize: 12 }}>Round trip</Text>
        <Text style={[styles.pm, { marginLeft: "auto" }]}>both hops</Text>
      </View>
      {leg("Out", out, setOutbound)}
      {roundTrip && (
        <>
          {leg(
            "Return",
            back,
            (p) => {
              if ("from" in p || "to" in p) setTouched(true);
              setBack((b) => ({ ...b, ...p }));
            },
            true,
          )}
          <Text style={styles.pm}>↺ airports mirrored · return = trip’s last day · edit either later</Text>
        </>
      )}
      <Button onPress={() => void save()} disabled={!body || saving}>
        {roundTrip ? "Save both flights" : "Save flight"}
      </Button>
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
  pfl: { fontFamily: F.mono, fontSize: 10.5, color: C.ink },
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
