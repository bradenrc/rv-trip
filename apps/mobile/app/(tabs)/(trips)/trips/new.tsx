import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { LodgingKind, PlaceSummary, TripDraft, TripModeChoice } from "@rv-trip/core";
import {
  BLANK_TRIP_DRAFT,
  LODGING_CHOICE_LABEL,
  RIG_CHOICES,
  TRIP_MODE_CHOICES,
  lodgingChoices,
  pickedFromSummary,
  tripDayCount,
  tripDefaultsPatch,
  tripDraftInput,
  tripModeChoice,
  withTripMode,
} from "@rv-trip/core";
import { api } from "../../../../src/api";
import { Input, Label } from "../../../../src/hops";
import { createTrip, patchTripDefaults, useBundle } from "../../../../src/store";
import { C, F, R } from "../../../../src/theme";
import { Button, Chip, Kicker, RangePicker } from "../../../../src/ui";

/**
 * New trip (#103 · Q12 C) — the web's three questions in the same order,
 * stacked. With `?edit=<id>` it is "Trip defaults": only the three blocks,
 * prefilled, and Save PATCHes only what changed (Greece reads "Fly & stay",
 * Q2 A). Copy and rules are core's (`TRIP_MODE_CHOICES`, `tripDraftInput`,
 * `tripDefaultsPatch`), so the two apps cannot drift.
 */
export default function NewTripScreen() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  return edit ? <TripDefaults id={edit} /> : <NewTrip />;
}

const MODE_GLYPH: Record<TripModeChoice, string> = { road: "🚐", air: "✈", mixed: "⇄" };

function ModeCards({
  value,
  onChange,
  subs,
}: {
  value: TripModeChoice | null;
  onChange: (m: TripModeChoice) => void;
  subs: boolean;
}) {
  return (
    <View style={styles.pc}>
      {TRIP_MODE_CHOICES.map((c) => {
        const on = value === c.value;
        return (
          <Pressable
            key={c.value}
            onPress={() => onChange(c.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.o, on && styles.oOn]}
          >
            <Text style={styles.oText}>
              {MODE_GLYPH[c.value]} {c.label}
            </Text>
            {subs && on && <Text style={styles.oSub}>{c.sub}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

function RowCards<T extends string | boolean>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={[styles.pc, styles.pcRow]}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.o, styles.oRow, on && styles.oOn]}
          >
            <Text style={styles.oText}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const lodgingOptions = (mode: TripModeChoice | null) =>
  lodgingChoices(mode).map((k) => ({ value: k, label: LODGING_CHOICE_LABEL[k] }));
const rigOptions = RIG_CHOICES.map((c) => ({ value: c.value, label: c.label }));

function Question({ n, children }: { n?: number; children: string }) {
  return (
    <View style={styles.pq}>
      {n !== undefined && <Text style={[styles.pqText, { color: C.greenInk }]}>{n}</Text>}
      <Text style={styles.pqText}>{children}</Text>
    </View>
  );
}

/** A place search's rows — the capture sheet's `api.places.search`, one field. */
function usePlaceResults(query: string, skip: string | null | undefined): PlaceSummary[] {
  const [results, setResults] = useState<PlaceSummary[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!q || q === skip) {
      setResults([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.places
        .search(q)
        .then((env) => live && setResults(env.results.slice(0, 5)))
        .catch(() => live && setResults([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, skip]);
  return results;
}

function Results({ rows, onPick }: { rows: PlaceSummary[]; onPick: (r: PlaceSummary) => void }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.results}>
      {rows.map((r, i) => (
        <Pressable
          key={r.googlePlaceId}
          onPress={() => onPick(r)}
          style={[styles.resultRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.borderSoft }]}
          accessibilityRole="button"
        >
          <Text style={{ color: C.ink, fontSize: 13, fontWeight: "600" }}>{r.name}</Text>
          {r.address ? <Text style={styles.pm}>{r.address}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/**
 * #126 · #127 (docs/design/130 frame 1): the phone asks **Where to?** first,
 * then **When** on the RangePicker twin; home base is a quiet chip reading the
 * household default, whose "change" writes this trip's override.
 */
function NewTrip() {
  const router = useRouter();
  const [draft, setDraft] = useState<TripDraft>(BLANK_TRIP_DRAFT);
  const [destQuery, setDestQuery] = useState("");
  const [homeQuery, setHomeQuery] = useState("");
  const [changingHome, setChangingHome] = useState(false);
  const [household, setHousehold] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<TripDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const input = tripDraftInput(draft);
  const days = tripDayCount(draft.startDate, draft.endDate);
  const destRows = usePlaceResults(destQuery, draft.destination?.name);
  const homeRows = usePlaceResults(homeQuery, draft.homeBasePlace?.name);
  const home = draft.homeBasePlace?.name ?? household;

  useEffect(() => {
    let live = true;
    api.prefs
      .get()
      .then((p) => live && setHousehold(p?.homeBasePlace?.name ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    if (!input || saving) return;
    setSaving(true);
    try {
      const trip = await createTrip(input);
      router.replace(`/trips/${trip.id}`);
    } catch {
      setSaving(false);
      Alert.alert("Didn’t save", "Couldn’t create that trip — nothing was saved.");
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "New trip" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Kicker color={C.accent}>New trip</Kicker>
        <Text style={styles.ph1}>Where to?</Text>

        <Label>Destination</Label>
        <Input
          value={destQuery}
          onChangeText={(q) => {
            setDestQuery(q);
            if (draft.destination && q !== draft.destination.name) set({ destination: null });
          }}
          placeholder="Bellingham, WA"
          autoCapitalize="words"
        />
        <Results
          rows={destRows}
          onPick={(r) => {
            const picked = pickedFromSummary(r);
            set({ destination: picked });
            setDestQuery(picked.name);
          }}
        />
        {changingHome ? (
          <>
            <Label>Starting from · this trip</Label>
            <Input
              value={homeQuery}
              onChangeText={(q) => {
                setHomeQuery(q);
                if (draft.homeBasePlace && q !== draft.homeBasePlace.name) set({ homeBasePlace: null });
              }}
              placeholder="Boise, ID"
              autoCapitalize="words"
            />
            <Results
              rows={homeRows}
              onPick={(r) => {
                const picked = pickedFromSummary(r);
                set({ homeBasePlace: picked });
                setHomeQuery(picked.name);
              }}
            />
          </>
        ) : (
          <View style={{ alignSelf: "flex-start" }}>
            <Chip onPress={() => setChangingHome(true)}>
              {home ? `🏠 from ${home} · your home base · change` : "🏠 no home base yet · set one"}
            </Chip>
          </View>
        )}

        <Label>When</Label>
        <RangePicker
          value={{ start: draft.startDate || null, end: draft.endDate || null }}
          onChange={(v) => set({ startDate: v.start ?? "", endDate: v.end ?? "" })}
        />

        <Question>Mostly</Question>
        <ModeCards value={draft.mode} onChange={(m) => setDraft((d) => withTripMode(d, m))} subs />

        {draft.mode !== null && (
          <>
            <Question>Where will you mostly sleep?</Question>
            <RowCards<LodgingKind>
              options={lodgingOptions(draft.mode)}
              value={draft.lodgingDefault}
              onChange={(lodgingDefault) => set({ lodgingDefault })}
            />
            {draft.mode === "road" && (
              <>
                <Question>Bringing the rig?</Question>
                <RowCards<boolean> options={rigOptions} value={draft.rigOn} onChange={(rigOn) => set({ rigOn })} />
              </>
            )}

            <Label>Trip name</Label>
            <Input
              value={draft.title}
              onChangeText={(title) => set({ title })}
              placeholder={draft.destination?.name ?? "Redwoods Run"}
              autoCapitalize="words"
            />

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Button onPress={() => void create()} disabled={!input || saving}>
                  {saving ? "Creating…" : "Create trip"}
                </Button>
              </View>
              {days !== null && <Text style={styles.pm}>{days} days</Text>}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

/** "Trip defaults" — the three blocks alone, prefilled; Save sends what changed. */
function TripDefaults({ id }: { id: string }) {
  const router = useRouter();
  const { bundle } = useBundle(id);
  const trip = bundle?.trip ?? null;
  const [mode, setMode] = useState<TripModeChoice | null>(null);
  const [lodging, setLodging] = useState<LodgingKind | null>(null);
  const [rigOn, setRigOn] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!trip || seeded) return;
    setMode(tripModeChoice(trip.defaultMode));
    setLodging(trip.lodgingDefault);
    setRigOn(trip.rigOn);
    setSeeded(true);
  }, [trip, seeded]);

  const save = async () => {
    if (!trip || !mode) return;
    try {
      await patchTripDefaults(id, tripDefaultsPatch(trip, { mode, lodgingDefault: lodging, rigOn }));
      router.back();
    } catch {
      Alert.alert("Didn’t save", "Your trip defaults — check your connection and try again.");
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Trip defaults",
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
              <Text style={{ color: C.inkMuted, fontSize: 14 }}>Cancel</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => void save()} hitSlop={8} accessibilityRole="button">
              <Text style={{ color: C.green, fontWeight: "700", fontSize: 14 }}>Save</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {trip && <Text style={styles.pm}>{trip.title}</Text>}
        <Question>How it moves</Question>
        <ModeCards
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m !== "road") setRigOn(false);
          }}
          subs={false}
        />
        <Question>Mostly sleeping in</Question>
        <RowCards<LodgingKind> options={lodgingOptions(mode)} value={lodging} onChange={setLodging} />
        {mode === "road" && (
          <>
            <Question>Bringing the rig?</Question>
            <RowCards<boolean> options={rigOptions} value={rigOn} onChange={setRigOn} />
          </>
        )}
        <Text style={[styles.pm, { marginTop: 6 }]}>Changes apply to hops you add from now on.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 8, paddingBottom: 64 },
  ph1: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5, color: C.ink, marginTop: -4, marginBottom: 4 },
  pq: { flexDirection: "row", gap: 6, marginTop: 6 },
  pqText: {
    fontFamily: F.mono,
    fontSize: 9.5,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.76,
    color: C.inkFaded,
  },
  pc: { gap: 5 },
  pcRow: { flexDirection: "row", flexWrap: "wrap" },
  o: {
    borderWidth: 1.5,
    borderColor: C.borderHi,
    borderRadius: R.card,
    backgroundColor: C.surface,
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 2,
  },
  oRow: { flexBasis: "46%", flexGrow: 1 },
  oOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  oText: { fontSize: 12.5, fontWeight: "700", color: C.ink },
  oSub: { fontSize: 10.5, color: C.inkMuted },
  pm: { fontFamily: F.mono, fontSize: 10.5, color: C.inkFaded },
  results: { borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  resultRow: { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: C.surface, gap: 2 },
});
