import { useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import type { HopBookingDraft, Trip } from "@rv-trip/core";
import {
  NO_HOME_BASE_COPY,
  blankHopDraft,
  boundaryFlightsBody,
  hopDraftZones,
  householdHomeBasePatch,
  isNoHomeBaseRefusal,
  mirrorReturnDraft,
  roundTripSavable,
} from "@rv-trip/core";
import { api } from "./api";
import { Input, Label, Sheet, failed, sheetStyles as styles } from "./hops";
import { PlaceSearchField, type Picked } from "./itinerary";
import { loadBundle, saveBoundaryFlights } from "./store";
import { C } from "./theme";
import { Button, Chip } from "./ui";

/**
 * #129 · Q10 A — Add flight from the trip's + Add: the two boundary hops in one
 * save. Round trip is ON by default; the return opens with the outbound's
 * airports mirrored and the trip's last day. The same core helpers as the web
 * sheet (`boundaryFlightsBody`, `mirrorReturnDraft`).
 *
 * #142 · Q4 C — with no effective home base (`trip.homeBase === null`, which
 * covers the trip's own and the household's) an amber chip says so under the
 * "Home ⇄ …" line and Save waits. Tapping the chip swaps in the shared place
 * search (no anchor); a pick writes the HOUSEHOLD home base and re-reads the
 * trip. The 409 `no_home_base` alert stays as the safety net.
 *
 * Moved out of hops.tsx for #142: it needs itinerary's PlaceSearchField, and
 * itinerary already imports from hops.
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
  const [settingHome, setSettingHome] = useState(false);
  const [savingHome, setSavingHome] = useState(false);
  const dest = trip.area?.name ?? trip.chapters.flatMap((l) => l.destinations)[0]?.place.name ?? "";

  const setOutbound = (patch: Partial<HopBookingDraft>) => {
    const next = { ...out, ...patch };
    setOut(next);
    if (!touched && ("from" in patch || "to" in patch)) {
      setBack((b) => ({ ...b, from: next.to, to: next.from, fromZone: next.toZone, toZone: next.fromZone }));
    }
  };
  const body = boundaryFlightsBody(roundTrip, out, roundTrip ? back : null);
  const savable = roundTripSavable(trip, body);
  const save = async () => {
    if (!body || !savable || saving) return;
    setSaving(true);
    try {
      await saveBoundaryFlights(trip.id, body);
      onClose();
    } catch (e) {
      setSaving(false);
      if (isNoHomeBaseRefusal(e)) Alert.alert("Didn’t save", NO_HOME_BASE_COPY);
      else failed("Those flights");
    }
  };
  const pickHome = async (p: Picked) => {
    if (savingHome) return;
    setSavingHome(true);
    try {
      await api.prefs.put(householdHomeBasePatch(p));
      await loadBundle(trip.id);
      setSettingHome(false);
    } catch {
      failed("That home base");
    } finally {
      setSavingHome(false);
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
          <Text style={[styles.pm, { color: C.warning }]}>An airport we don’t know — add this flight on its hop to pick a zone.</Text>
        ) : null}
      </View>
    );
  };
  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.st}>✈ Add flight</Text>
      <Text style={styles.pm}>Home {roundTrip ? "⇄" : "→"} {dest}</Text>
      {trip.homeBase === null &&
        (settingHome ? (
          <>
            <Label>Home base</Label>
            <PlaceSearchField anchor={null} onPick={(p) => void pickHome(p)} />
          </>
        ) : (
          <>
            <View style={{ alignSelf: "flex-start" }}>
              <Chip warn onPress={() => setSettingHome(true)}>
                🏠 no home base yet · set one
              </Chip>
            </View>
            <Text style={styles.pm}>Round-trip flights start and end at home.</Text>
          </>
        ))}
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
      <Button onPress={() => void save()} disabled={!savable || saving}>
        {roundTrip ? "Save both flights" : "Save flight"}
      </Button>
    </Sheet>
  );
}
