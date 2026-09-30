import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  DateRangeValue,
  IdeaCategory,
  LodgingKind,
  Place,
  ReservationDraft,
  ReservationType,
  SearchAnchor,
  Stop,
  Trip,
} from "@rv-trip/core";
import {
  LODGING_KIND_LABEL,
  PICKER_DEBOUNCE_MS,
  STAY_KINDS,
  isScheduled,
  lodgingKindOfGoogle,
  nightsLabel,
  orderedStops,
  rangeNights,
  reservationDraftInput,
  searchAnchor,
  searchAnchorChip,
  stayDraft,
  stayKindChipLabel,
  stayKindIsFromGoogle,
  stayKindType,
  stepNights,
  withStayKind,
} from "@rv-trip/core";
import type { PlacesSearchEnvelope } from "@rv-trip/core/api-client";
import { api } from "./api";
import { Input, Label, Sheet, failed } from "./hops";
import { addStay, addStop, planIdeaToStop, planPinnedIdea, planStayIdea, updateTrip } from "./store";
import { appendShelfIdea } from "@rv-trip/core";
import { C, F, R } from "./theme";
import { Button, CategoryTile, Chip, RangePicker, Segmented } from "./ui";

/**
 * The phone's Itinerary · Ideas pieces (#131 · #128 · #126 — docs/design/130
 * frames 2–5 and 9): the trip's in-masthead + Add sheet, the anchored place
 * search (never the caller's IP — #126's `searchAnchor`), the Add stay sheet
 * (lodging first, dates from the stop), + Add ▸ Stop, and the Ideas tab with
 * its Plan it. The tab-bar + stays #112's global capture — unchanged.
 */

const TILE: Record<IdeaCategory, ReservationType> = { do: "activity", eat: "dining", stay: "lodging" };

type Picked = {
  name: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  address: string | null;
  /** Google's `primaryType` — #144 seeds a new stay's kind from it. */
  primaryType: string | null;
};

/** The anchored search: a box, the "near …" chip, the rows, and — with
 * `lodging` — "Show all places, not just lodging". */
export function PlaceSearchField({
  anchor,
  lodging = false,
  onPick,
}: {
  anchor: SearchAnchor | null;
  lodging?: boolean;
  onPick: (p: Picked) => void;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [env, setEnv] = useState<PlacesSearchEnvelope | null>(null);
  useEffect(() => {
    const text = q.trim();
    if (!text) return;
    let live = true;
    const t = setTimeout(() => {
      api.places
        .search(text, anchor ?? undefined, lodging && !all ? "lodging" : undefined)
        .then((e) => live && setEnv(e))
        .catch(() => live && setEnv({ results: [], degraded: true, reason: "upstream_error" }));
    }, PICKER_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, all, lodging, anchor?.lat, anchor?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = q.trim() ? (env?.results ?? []) : [];
  return (
    <View style={{ gap: 6 }}>
      <Input value={q} onChangeText={setQ} placeholder={lodging ? "Search a hotel, campground…" : "Search a place"} autoCapitalize="words" />
      <View style={{ alignSelf: "flex-start" }}>
        <Chip on={anchor !== null}>📍 {searchAnchorChip(anchor)}</Chip>
      </View>
      {q.trim() !== "" && (
        <View style={styles.rows}>
          {rows.slice(0, 6).map((r, i) => (
            <Pressable
              key={r.googlePlaceId}
              onPress={() =>
                onPick({
                  name: r.name,
                  lat: r.location?.lat ?? null,
                  lng: r.location?.lng ?? null,
                  googlePlaceId: r.googlePlaceId,
                  address: r.address,
                  primaryType: r.primaryType ?? null,
                })
              }
              accessibilityRole="button"
              style={[styles.row, i > 0 && styles.rule]}
            >
              <CategoryTile type={lodging ? "lodging" : "other"} size={24} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rn} numberOfLines={1}>
                  {r.name}
                </Text>
                {r.address ? (
                  <Text style={styles.rs} numberOfLines={1}>
                    {r.address}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {/* The escape row: a name with no place behind it is still legal. */}
          <Pressable
            onPress={() => onPick({ name: q.trim(), lat: null, lng: null, googlePlaceId: null, address: null, primaryType: null })}
            accessibilityRole="button"
            style={[styles.row, rows.length > 0 && styles.rule]}
          >
            <Text style={styles.rs}>Use “{q.trim()}” as typed</Text>
          </Pressable>
          {lodging && !all && (
            <Pressable onPress={() => setAll(true)} accessibilityRole="button" style={[styles.row, styles.rule]}>
              <Text style={[styles.rs, { textAlign: "center", flex: 1, color: C.inkMuted }]}>
                Show all places, not just lodging
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const KIND_OPTIONS = STAY_KINDS.map((k) => ({ value: k, label: LODGING_KIND_LABEL[k] }));

const placeOf = (p: Picked): Place => ({ name: p.name, lat: p.lat, lng: p.lng, googlePlaceId: p.googlePlaceId });

/** The trip's + Add (frame 3): tab-scoped. */
export function AddSheet({
  tab,
  onClose,
  onFlight,
  onStay,
  onStop,
  onIdea,
  onSwitchToIdeas,
}: {
  tab: "itinerary" | "ideas";
  onClose: () => void;
  onFlight: () => void;
  onStay: () => void;
  onStop: () => void;
  onIdea: (k: IdeaCategory) => void;
  onSwitchToIdeas: () => void;
}) {
  const item = (tile: ReservationType, title: string, hint: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.mi}>
      <CategoryTile type={tile} size={24} />
      <Text style={styles.miText}>{title}</Text>
      <Text style={styles.miHint}>{hint}</Text>
    </Pressable>
  );
  return (
    <Sheet visible onClose={onClose}>
      {tab === "itinerary" ? (
        <>
          <Text style={styles.mh}>Add to Itinerary · the knowns</Text>
          {item("transport", "Flight", "round trip on", onFlight)}
          {item("lodging", "Stay", "hotel · campground · friends", onStay)}
          {item("other", "Stop", "a new place", onStop)}
          <Text style={styles.mh}>Not sure yet?</Text>
          <Pressable onPress={onSwitchToIdeas} accessibilityRole="button" style={styles.mi}>
            <Text style={[styles.miText, { color: C.inkFaded, fontWeight: "500" }]}>Switch to Ideas → idea · save</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.mh}>Add to Ideas · the maybes</Text>
          {item("activity", "Something to do", "idea", () => onIdea("do"))}
          {item("dining", "Somewhere to eat", "idea", () => onIdea("eat"))}
          {item("lodging", "Somewhere to stay", "idea", () => onIdea("stay"))}
        </>
      )}
    </Sheet>
  );
}

/** + Add ▸ Stop: a place, appended to the last leg, floating until dated. */
export function AddStopSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const last = orderedStops(trip).at(-1) ?? null;
  const anchor = searchAnchor(trip, { kind: "after", stopId: last?.id ?? null });
  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.st}>Add stop</Text>
      <PlaceSearchField
        anchor={anchor}
        onPick={(p) => {
          onClose();
          void addStop(trip.id, placeOf(p)).catch(() => failed("That stop"));
        }}
      />
    </Sheet>
  );
}

/** Ideas ▸ + Add: a maybe of a kind, named by its place. */
export function AddIdeaSheet({ trip, kind, onClose }: { trip: Trip; kind: IdeaCategory; onClose: () => void }) {
  return (
    <Sheet visible onClose={onClose}>
      <Text style={styles.st}>
        {kind === "stay" ? "Somewhere to stay" : kind === "eat" ? "Somewhere to eat" : "Something to do"}
      </Text>
      <PlaceSearchField
        anchor={searchAnchor(trip, { kind: "ideas" })}
        onPick={(p) => {
          onClose();
          void api.ideas
            .create({ tripId: trip.id, stopId: null, category: kind, title: p.name, status: "idea", place: placeOf(p) })
            .then((idea) => updateTrip(trip.id, (t) => appendShelfIdea(t, idea)))
            .catch(() => failed("That idea"));
        }}
      />
    </Sheet>
  );
}

/**
 * Add stay (frames 4–5 · #128 · Q8 A · Q9 A): the name field IS an anchored
 * lodging search; then the dates, from the stop, with a nights stepper.
 */
export function AddStaySheetPhone({
  trip,
  stopId,
  onClose,
  onIdeaInstead,
}: {
  trip: Trip;
  stopId: string | null;
  onClose: () => void;
  onIdeaInstead: () => void;
}) {
  const stops = orderedStops(trip);
  const target: Stop | null =
    stops.find((s) => s.id === stopId) ??
    stops.find((s) => !s.reservations.some((r) => r.type === "lodging" || r.type === "campground")) ??
    stops[0] ??
    null;
  const anchor = target ? searchAnchor(trip, { kind: "stop", stopId: target.id }) : searchAnchor(trip, { kind: "trip" });
  const [picked, setPicked] = useState<Picked | null>(null);
  // #144 · Q9 B — the kind is Google's when its type says lodging/campground,
  // else the trip's default; the chip says which, and opens the switch.
  const [kind, setKind] = useState<LodgingKind>(() => lodgingKindOfGoogle(null, trip.lodgingDefault));
  const [fromGoogle, setFromGoogle] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const pick = (p: Picked) => {
    setPicked(p);
    setKind(lodgingKindOfGoogle(p.primaryType, trip.lodgingDefault));
    setFromGoogle(stayKindIsFromGoogle(p.primaryType));
    setKindOpen(false);
  };
  const friends = kind === "friends";
  const span =
    target && isScheduled(target)
      ? { start: target.arriveDate, end: target.departDate }
      : { start: trip.startDate, end: trip.endDate };
  const [range, setRange] = useState<DateRangeValue>(span);
  const [conf, setConf] = useState("");
  const [saving, setSaving] = useState(false);
  const complete = range.start && range.end ? { start: range.start, end: range.end } : null;
  const draft: ReservationDraft | null =
    picked && complete
      ? {
          ...withStayKind(stayDraft(kind), kind),
          name: picked.name,
          checkIn: complete.start,
          checkOut: complete.end,
          // Friends has no paperwork (withStayKind) — the field hides below.
          confirmationNumber: friends ? "" : conf,
        }
      : null;
  const body = draft ? reservationDraftInput(target?.id ?? "pending", draft) : null;

  const save = async () => {
    if (!picked || !draft || !body || !complete || saving) return;
    setSaving(true);
    try {
      let id: string | null = target?.id ?? null;
      if (!id) id = await addStop(trip.id, placeOf(picked), { arriveDate: complete.start, departDate: complete.end });
      const real = id ? reservationDraftInput(id, draft) : null;
      if (real) await addStay(trip.id, real);
      onClose();
    } catch {
      setSaving(false);
      failed("That stay");
    }
  };

  return (
    <Sheet visible onClose={onClose}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Text style={styles.st}>🛏 Add stay</Text>
        <Text style={[styles.rs, { marginLeft: "auto" }]}>{picked ? "step 2 of 2" : (target?.place.name ?? "")}</Text>
      </View>
      {!picked ? (
        <>
          <PlaceSearchField anchor={anchor} lodging onPick={pick} />
          <Pressable onPress={onIdeaInstead} accessibilityRole="button">
            <Text style={[styles.rs, { textAlign: "center", textDecorationLine: "underline" }]}>
              Just considering? Save it as an idea instead
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.row}>
            <CategoryTile type={stayKindType(kind)} size={24} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rn}>{picked.name}</Text>
              <Text style={styles.rs}>{picked.address ?? target?.place.name ?? ""}</Text>
            </View>
          </View>
          <View style={{ alignSelf: "flex-start" }}>
            <Chip on={fromGoogle} onPress={() => setKindOpen((o) => !o)}>
              {stayKindChipLabel(kind, fromGoogle)}
            </Chip>
          </View>
          {kindOpen && (
            <Segmented
              value={kind}
              options={KIND_OPTIONS}
              onChange={(k) => {
                setKind(k);
                setFromGoogle(false);
              }}
            />
          )}
          <Label>Check-in → check-out</Label>
          <RangePicker value={range} tripSpan={{ start: trip.startDate, end: trip.endDate }} onChange={setRange} />
          {complete && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {target && complete.start === target.arriveDate && complete.end === target.departDate ? (
                <Text style={[styles.rs, { color: C.greenInk }]}>✓ covers your whole stay at {target.place.name}</Text>
              ) : (
                <Text style={styles.rs}>{nightsLabel(rangeNights(complete.start, complete.end))}</Text>
              )}
              <View style={{ marginLeft: "auto", flexDirection: "row", gap: 5 }}>
                <Chip onPress={() => setRange(stepNights(complete, -1))}>−</Chip>
                <Chip onPress={() => setRange(stepNights(complete, 1))}>+</Chip>
              </View>
            </View>
          )}
          {!friends && (
            <>
              <Label>Confirmation # · cost</Label>
              <Input mono value={conf} onChangeText={setConf} placeholder="optional" />
            </>
          )}
          <Button onPress={() => void save()} disabled={!body || saving}>
            Save stay
          </Button>
        </>
      )}
    </Sheet>
  );
}

/** Ideas (frame 9): every maybe, grouped, with Plan it. */
export function IdeasTab({ trip }: { trip: Trip }) {
  const stops = orderedStops(trip);
  const pinned = stops
    .map((s) => ({ stop: s, ideas: s.ideas.filter((i) => i.status === "idea") }))
    .filter((g) => g.ideas.length > 0);
  const shelf = trip.ideas.filter((i) => i.status === "idea");
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [stayFor, setStayFor] = useState<string | null>(null);
  const [range, setRange] = useState<DateRangeValue>({ start: trip.startDate, end: trip.endDate });

  const row = (title: string, category: IdeaCategory, onPlan: () => void) => (
    <View style={[styles.card, styles.row]}>
      <CategoryTile type={TILE[category]} size={24} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rn} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rs}>idea</Text>
      </View>
      <Chip on onPress={onPlan}>
        Plan it
      </Chip>
    </View>
  );

  return (
    <View style={{ gap: 8 }}>
      {pinned.length === 0 && shelf.length === 0 && (
        <Text style={styles.rs}>No maybes yet — + Add one, or pull one in from your Saves.</Text>
      )}
      {pinned.map(({ stop, ideas }) => (
        <View key={stop.id} style={{ gap: 6 }}>
          <Label>
            Pinned to {stop.place.name} · {ideas.length}
          </Label>
          {ideas.map((i) => (
            <View key={i.id}>{row(i.title, i.category, () => void planPinnedIdea(trip.id, stop.id, i.id).catch(() => failed("Plan it")))}</View>
          ))}
        </View>
      ))}
      {shelf.length > 0 && <Label>For the trip · {shelf.length}</Label>}
      {shelf.map((i) => (
        <View key={i.id}>
          {row(i.title, i.category, () => (i.category === "stay" ? setStayFor(i.id) : setPickFor(i.id)))}
        </View>
      ))}

      {pickFor && (
        <Sheet visible onClose={() => setPickFor(null)}>
          <Text style={styles.st}>Plan it at…</Text>
          {stops.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                const id = pickFor;
                setPickFor(null);
                void planIdeaToStop(trip.id, id, s.id).catch(() => failed("Plan it"));
              }}
              accessibilityRole="button"
              style={styles.mi}
            >
              <Text style={styles.miText}>{s.place.name}</Text>
            </Pressable>
          ))}
        </Sheet>
      )}
      {stayFor && (
        <Sheet visible onClose={() => setStayFor(null)}>
          <Text style={styles.st}>Plan it — its nights</Text>
          <RangePicker value={range} tripSpan={{ start: trip.startDate, end: trip.endDate }} onChange={setRange} />
          <Button
            disabled={!range.start || !range.end}
            onPress={() => {
              const id = stayFor;
              setStayFor(null);
              if (range.start && range.end) {
                void planStayIdea(trip.id, id, { start: range.start, end: range.end }).catch(() => failed("Plan it"));
              }
            }}
          >
            Plan it
          </Button>
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, paddingHorizontal: 9 },
  rule: { borderTopWidth: 1, borderTopColor: C.borderSoft },
  rn: { color: C.ink, fontSize: 12.5, fontWeight: "700" },
  rs: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
  st: { fontSize: 16, fontWeight: "800", color: C.ink },
  mh: {
    fontFamily: F.mono,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: C.inkFaded,
    paddingTop: 4,
  },
  mi: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  miText: { color: C.ink, fontSize: 13.5, fontWeight: "600" },
  miHint: { marginLeft: "auto", fontFamily: F.mono, fontSize: 10.5, color: C.inkFaded },
  card: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, borderRadius: R.card },
});
