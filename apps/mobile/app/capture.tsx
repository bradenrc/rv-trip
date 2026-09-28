import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import type { CaptureDraft, DidItBody, Idea, PlaceSummary, ReservationType, SavedPlaceStatus } from "@rv-trip/core";
import {
  DEFAULT_STYLE_MODE,
  OFFLINE_NOTICE,
  didItBody,
  didItContext,
  PIN_KINDS,
  captureFieldPlaceholder,
  captureRows,
  formatCoords,
  newClientId,
  noteCaptureBody,
  noteRowSubline,
  noteRowTitle,
  pinCaptureBody,
  pinRowSubline,
  placeCaptureBody,
  placeRowSubline,
  reservationTypeOfGoogle,
} from "@rv-trip/core";
import { api } from "../src/api";
import { capture, loadRecents, queueDidIt, useCaptureState } from "../src/capture";
import { AgainPair, LogCta } from "../src/journal";
import { addProvisionalIdea, replaceIdea, useTodaysStop } from "../src/store";
import { PinMap, useStyleMode } from "../src/map";
import { C, F, R } from "../src/theme";
import { CategoryTile, Chip, Stars, Toast } from "../src/ui";

/**
 * The capture sheet (#111 · docs/design/111 #100, Q2 A) — a root formSheet the
 * center + opens from any tab.
 *
 * ONE smart field and no mode to pick. What the list offers, and in what
 * order, is core's `captureRows`: online it is Google's rows, then "save as a
 * note", then "drop a pin"; an empty field shows only the pin; offline the
 * search row greys out and the pin (empty field) or the note (typed text) moves
 * to the top. A place or a note goes through the confirm step (Want / Been,
 * Heard from, an optional why); a pin goes through the pin sub-screen.
 *
 * Nothing here waits on the network to save: Save closes the sheet and hands
 * the body to the queue (`src/capture.ts`), which sends it now or when signal
 * comes back. Every string is core's (`capture/sheet.ts`) or the wireframe's.
 */

type Fix = { lat: number; lng: number; accuracy: number | null };

type Step =
  | { kind: "find" }
  | { kind: "confirm"; target: { kind: "place"; hit: PlaceSummary } | { kind: "note"; text: string } }
  | { kind: "pin" };

const SEARCH_DEBOUNCE_MS = 300;

export default function CaptureSheet() {
  const router = useRouter();
  const { online } = useCaptureState();
  const [step, setStep] = useState<Step>({ kind: "find" });
  const [query, setQuery] = useState("");
  const { fix, locationOff } = useFix();
  const results = usePlaceSearch(query, online, fix);
  const areaName = useResolvedName(online ? fix : null);

  useEffect(() => {
    void loadRecents();
  }, []);

  const save = (draft: CaptureDraft) => {
    router.back();
    void capture(draft);
  };

  if (step.kind === "confirm") {
    return (
      <Confirm
        target={step.target}
        online={online}
        fix={fix}
        areaName={areaName}
        onSave={save}
      />
    );
  }
  if (step.kind === "pin" && fix) {
    return <PinScreen fix={fix} online={online} onSave={save} />;
  }

  const rows = captureRows(query, online);
  const typed = query.trim().length > 0;

  const noteRow = (chosen: boolean, first = chosen) => (
    <Row
      key="note"
      chosen={chosen}
      first={first}
      lead={<Glyph>≡</Glyph>}
      title={noteRowTitle(query)}
      sub={noteRowSubline(online ? areaName : null)}
      disabled={!typed}
      onPress={() => setStep({ kind: "confirm", target: { kind: "note", text: query } })}
    />
  );
  const pinRow = (chosen: boolean) => (
    <Row
      key="pin"
      chosen={chosen}
      first={chosen}
      lead={<Glyph>⌖</Glyph>}
      title="Drop a pin here"
      sub={locationOff ? "location is off" : pinRowSubline(fix, online)}
      disabled={!fix}
      onPress={() => setStep({ kind: "pin" })}
    />
  );
  const searchOffRow = (
    <Row key="search-off" lead={<Glyph>⌕</Glyph>} title="Search places" sub="needs signal" disabled dim />
  );

  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <View style={styles.field}>
        <Text style={styles.fieldGlyph}>⌕</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={captureFieldPlaceholder(online)}
          placeholderTextColor={C.inkSubtle}
          style={styles.fieldInput}
          autoFocus
          autoCorrect={false}
          returnKeyType="done"
          selectionColor={C.green}
        />
      </View>

      {!online && (
        <Toast tone="amber" glyph="⊘" title={OFFLINE_NOTICE.title} sub={OFFLINE_NOTICE.sub} />
      )}

      {online && typed ? (
        <>
          {results.length > 0 && (
            <>
              <Text style={styles.grp}>Places</Text>
              <View style={styles.rows}>
                {results.map((hit, i) => (
                  <Row
                    key={hit.googlePlaceId}
                    chosen={i === 0}
                    first={i === 0}
                    lead={<CategoryTile type={reservationTypeOfGoogle(hit.primaryType)} size={26} />}
                    title={hit.name}
                    sub={placeRowSubline(hit)}
                    onPress={() => setStep({ kind: "confirm", target: { kind: "place", hit } })}
                  />
                ))}
              </View>
              <Text style={styles.grp}>Or</Text>
            </>
          )}
          <View style={styles.rows}>
            {noteRow(results.length === 0, true)}
            {pinRow(false)}
          </View>
        </>
      ) : (
        <View style={styles.rows}>
          {rows.map((r, i) =>
            r === "pin" ? pinRow(i === 0) : r === "note" ? noteRow(i === 0) : r === "search-off" ? searchOffRow : null,
          )}
        </View>
      )}
    </ScrollView>
  );
}

// ── the confirm step ────────────────────────────────────────────────────────

function Confirm({
  target,
  online,
  fix,
  areaName,
  onSave,
}: {
  target: { kind: "place"; hit: PlaceSummary } | { kind: "note"; text: string };
  online: boolean;
  fix: Fix | null;
  areaName: string | null;
  onSave: (draft: CaptureDraft) => void;
}) {
  const { recents } = useCaptureState();
  const router = useRouter();
  // #113 · "Did it" — only while a trip is in progress and one of its stops
  // covers today (core's `todaysStop`, over the bundles the phone holds —
  // persisted for the trip in progress, so this works with no signal).
  const today = useTodaysStop();
  const [status, setStatus] = useState<SavedPlaceStatus | "did">("want");
  const [rating, setRating] = useState(0);
  const [again, setAgain] = useState<boolean | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [addingWho, setAddingWho] = useState(false);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const placeAt = target.kind === "place" ? target.hit.location : null;
  const placeDest = useResolvedName(online ? placeAt : null);

  const name = target.kind === "place" ? target.hit.name : target.text.trim();
  const type: ReservationType = target.kind === "place" ? reservationTypeOfGoogle(target.hit.primaryType) : "other";
  const dest = target.kind === "place" ? placeDest : online ? areaName : null;
  const chosenSource = addingWho ? who : source;

  const didIt = status === "did" && today !== null;
  const submit = () => {
    if (status === "did") {
      if (!today) return;
      const clientId = newClientId();
      const body = didItBody(
        { clientId, tripId: today.trip.id, stopId: today.stop.id },
        target.kind === "place"
          ? { kind: "place", hit: target.hit }
          : { kind: "note", text: target.text, at: fix, areaLabel: online ? areaName : null },
        { rating: rating === 0 ? null : rating, again, note },
      );
      const tripId = today.trip.id;
      // The idea is on today's stop at once (provisional id = its clientId);
      // the created row replaces it when the POST lands.
      addProvisionalIdea(tripId, today.stop.id, provisionalIdea(body));
      router.back();
      void queueDidIt(body, {
        tripTitle: today.trip.title,
        undo: (created) => {
          replaceIdea(tripId, created?.id ?? clientId, null);
          if (created) void api.ideas.remove(created.id).catch(() => undefined);
        },
      });
      return;
    }
    const c = { status, source: chosenSource, note };
    onSave(
      target.kind === "place"
        ? placeCaptureBody(target.hit, c)
        : noteCaptureBody(target.text, fix, online ? areaName : null, online, c),
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <CategoryTile type={type} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.confirmName} numberOfLines={2}>
            {name}
          </Text>
          {dest ? <Text style={styles.mono}>→ {dest}</Text> : null}
        </View>
      </View>

      <View style={styles.chips}>
        <Chip on={status === "want"} onPress={() => setStatus("want")}>
          Want to go
        </Chip>
        <Chip on={status === "been"} onPress={() => setStatus("been")}>
          Been there
        </Chip>
        {today && (
          <Chip on={status === "did"} onPress={() => setStatus("did")}>
            Did it
          </Chip>
        )}
      </View>

      {didIt && (
        <>
          <Text style={styles.mono}>{didItContext(today.trip.title, today.stop.place.name)}</Text>
          <Stars value={rating} size={28} onSet={setRating} />
          <Text style={styles.lbl}>Do it again?</Text>
          <AgainPair value={again} onChange={setAgain} />
        </>
      )}

      {status === "want" && (
        <>
          <Text style={styles.lbl}>Heard from</Text>
          <View style={styles.chips}>
            {recents.map((r) => (
              <Chip
                key={r}
                on={!addingWho && source === r}
                onPress={() => {
                  setAddingWho(false);
                  setSource(source === r ? null : r);
                }}
              >
                {r}
              </Chip>
            ))}
            <Chip on={addingWho} onPress={() => setAddingWho(!addingWho)}>
              + who
            </Chip>
          </View>
          {addingWho && (
            <TextInput
              value={who}
              onChangeText={setWho}
              placeholder="+ who"
              placeholderTextColor={C.inkSubtle}
              style={styles.note}
              autoFocus
              selectionColor={C.green}
            />
          )}
        </>
      )}

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={didIt ? "For next time…" : "Why? (optional)"}
        placeholderTextColor={C.inkSubtle}
        style={styles.note}
        multiline
        selectionColor={C.green}
      />

      {didIt ? <LogCta onPress={submit} /> : <Cta onPress={submit}>Save</Cta>}
    </ScrollView>
  );
}

/** The idea as the stop screen shows it before the POST lands. */
function provisionalIdea(body: DidItBody): Idea {
  return {
    id: body.clientId,
    tripId: body.tripId,
    stopId: body.stopId ?? null,
    title: body.title,
    category: body.category ?? "do",
    status: "done",
    place: body.place
      ? {
          name: body.place.name,
          lat: body.place.lat ?? null,
          lng: body.place.lng ?? null,
          googlePlaceId: body.place.googlePlaceId ?? null,
        }
      : null,
    rating: body.rating ?? null,
    again: body.again ?? null,
    notes: body.notes ?? null,
    sortOrder: Number.MAX_SAFE_INTEGER,
    lastChange: null,
  };
}

// ── the pin sub-screen ─────────────────────────────────────────────────────

function PinScreen({ fix, online, onSave }: { fix: Fix; online: boolean; onSave: (d: CaptureDraft) => void }) {
  const [mode] = useStyleMode();
  const [at, setAt] = useState({ lat: fix.lat, lng: fix.lng });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ReservationType>(PIN_KINDS[0]!.type);

  return (
    <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <PinMap at={fix} mode={mode ?? DEFAULT_STYLE_MODE} onMove={setAt} label={formatCoords(at.lat, at.lng)} />
      <Text style={styles.lbl}>Drag the map to nudge the pin</Text>
      <View style={[styles.field, { paddingVertical: 0 }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name this pin"
          placeholderTextColor={C.inkSubtle}
          style={[styles.fieldInput, { fontSize: 13 }]}
          autoFocus
          selectionColor={C.green}
        />
      </View>
      <View style={styles.chips}>
        {PIN_KINDS.map((k) => (
          <Chip key={k.type} on={kind === k.type} onPress={() => setKind(k.type)}>
            {k.label}
          </Chip>
        ))}
      </View>
      <Cta onPress={() => onSave(pinCaptureBody(name, at, kind, online))}>Save pin</Cta>
    </ScrollView>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Row({
  lead,
  title,
  sub,
  chosen = false,
  first = false,
  disabled = false,
  dim = false,
  onPress,
}: {
  /** First row of its box: no top rule (`.row:first-child`). */
  first?: boolean;
  lead: ReactNode;
  title: string;
  sub: string;
  chosen?: boolean;
  disabled?: boolean;
  /** The greyed "Search places · needs signal" row. */
  dim?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || !onPress }}
      style={({ pressed }) => [
        styles.row,
        first && { borderTopWidth: 0 },
        { backgroundColor: chosen || pressed ? C.greenSoft : C.surface },
        dim && { opacity: 0.5 },
      ]}
    >
      {lead}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

function Glyph({ children }: { children: string }) {
  return (
    <View style={styles.gl}>
      <Text style={styles.glText}>{children}</Text>
    </View>
  );
}

function Cta({ children, onPress }: { children: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.ctaText}>✓ {children}</Text>
    </Pressable>
  );
}

// ── hooks ───────────────────────────────────────────────────────────────────

/** Where the phone is. GPS works without signal, so a pin is always possible. */
function useFix(): { fix: Fix | null; locationOff: boolean } {
  const [fix, setFix] = useState<Fix | null>(null);
  const [locationOff, setLocationOff] = useState(false);
  useEffect(() => {
    let live = true;
    const take = (p: Location.LocationObject | null) => {
      if (live && p) setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
    };
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (live) setLocationOff(true);
          return;
        }
        take(await Location.getLastKnownPositionAsync());
        take(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
      } catch {
        if (live) setLocationOff(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return { fix, locationOff };
}

/** Google's rows for the field, biased to where you are. Online only. */
function usePlaceSearch(query: string, online: boolean, near: Fix | null): PlaceSummary[] {
  const [results, setResults] = useState<PlaceSummary[]>([]);
  const nearRef = useRef(near);
  nearRef.current = near;
  useEffect(() => {
    const q = query.trim();
    if (!online || !q) {
      setResults([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const at = nearRef.current;
      api.places
        .search(q, at ? { lat: at.lat, lng: at.lng } : undefined)
        .then((env) => {
          if (live) setResults(env.results);
        })
        .catch(() => {
          if (live) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, online]);
  return results;
}

/** The destination a point resolves to ("San José, Costa Rica"), or null. */
function useResolvedName(at: { lat: number; lng: number } | null): string | null {
  const [name, setName] = useState<string | null>(null);
  const lat = at?.lat;
  const lng = at?.lng;
  useEffect(() => {
    if (lat == null || lng == null) return;
    let live = true;
    api.destinations
      .resolve({ lat, lng })
      .then((d) => {
        if (live) setName(d?.name ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Resolve once per ~100 m move, not on every GPS jitter.
  }, [lat == null ? null : lat.toFixed(3), lng == null ? null : lng.toFixed(3)]); // eslint-disable-line react-hooks/exhaustive-deps
  return name;
}

// docs/design/111's sheet, row, chip and CTA metrics.
const styles = StyleSheet.create({
  sheet: { padding: 12, paddingTop: 20, gap: 8, backgroundColor: C.surface, flexGrow: 1 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: C.green,
    borderRadius: R.card,
    paddingHorizontal: 10,
    paddingVertical: 2,
    backgroundColor: C.surfaceAlt,
  },
  fieldGlyph: { color: C.inkFaded, fontSize: 16 },
  fieldInput: { flex: 1, color: C.ink, fontSize: 14, paddingVertical: 8 },
  grp: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: C.inkFaded,
    paddingHorizontal: 2,
    paddingTop: 2,
  },
  rows: { borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  row: {
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
  },
  rowTitle: { fontSize: 13, fontWeight: "700", color: C.ink, lineHeight: 16 },
  rowSub: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
  gl: {
    width: 22,
    height: 22,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.borderHi,
    alignItems: "center",
    justifyContent: "center",
  },
  glText: { color: C.inkMuted, fontSize: 12 },
  confirmName: { fontWeight: "800", fontSize: 16, color: C.ink },
  mono: { fontFamily: F.mono, fontSize: 10.5, color: C.inkFaded },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  lbl: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: C.inkFaded,
  },
  note: {
    fontSize: 12.5,
    color: C.inkMuted,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: C.surfaceAlt,
  },
  cta: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.green,
    borderRadius: R.card,
    paddingVertical: 11,
    width: "100%",
  },
  ctaText: { color: C.navy, fontWeight: "800", fontSize: 14 },
});
