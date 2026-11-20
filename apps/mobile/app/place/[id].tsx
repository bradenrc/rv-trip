import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router as appRouter, useLocalSearchParams, useRouter } from "expo-router";
import type { DrillDoor, DrillGroup, ReservationType, SavedPlace, SavedPlaceStatus, SavePlaceForm } from "@rv-trip/core";
import {
  EDIT_OFFLINE_NOTICE,
  SAVE_SHEET_TYPES,
  categoryOf,
  drillDoors,
  drillGroupLabel,
  editPlacePatch,
  navigateLinksForPlace,
  placeGoogleLine,
  placeScreenMeta,
  placeSourceLine,
  placeTelUrl,
  placeTripLine,
  savePlaceFormFromSaved,
} from "@rv-trip/core";
import type { PlaceDetailsEnvelope } from "@rv-trip/core/api-client";
import { API_URL, api } from "../../src/api";
import { announceDeleteNeedsSignal, announceRemoved, announceRestored, useCaptureState } from "../../src/capture";
import { Input, Label, Sheet } from "../../src/hops";
import { AgainBadge } from "../../src/journal";
import { Suggestion } from "../../src/places";
import { deleteSave, patchSave, restoreSave, useSaves, useTrips } from "../../src/store";
import { C, F, R } from "../../src/theme";
import { CaptureToastHost } from "../../src/toast-host";
import { Button, CategoryTile, Centered, Chip, Muted, Stars } from "../../src/ui";

type Details = PlaceDetailsEnvelope["results"][number];

/**
 * The Place screen (#197 · #193 · docs/design/197 §2 frames 1–4): one saved
 * place, pushed on the ROOT Stack over the tabs (registered in
 * `app/_layout.tsx` beside `capture`), so it is reachable from Places, Map and
 * a trip's Journal without a tab switch, and ‹ returns to where you came from.
 *
 * Four blocks, always in this order, and missing data removes a block or a
 * button rather than leaving a dead one:
 *   1. what it is — CategoryTile 40, the name, core's `placeScreenMeta`;
 *   2. Go — Google · Apple · Waze from core's `navigateLinksForPlace`, then
 *      Call / Website only when Google's details carry them (q5 A), then On the
 *      map. No point → no Go block; a note with a suggestion shows the shipped
 *      locate strip (`Suggestion`) in its slot instead (frame 4);
 *   3. Yours — the shelf switch (`patchSave {status}`), on Been there the Sky
 *      stars (`patchSave {rating}`) and the Again badge, the note, the trip
 *      link, the source line;
 *   4. What others say — the G line (the twin of the web's GoogleLine, four
 *      states) and core's doors, grouped, as text chips (q2 A).
 *
 * There is no single-place read: the save is found in `useSaves()` (which
 * loads the list when it isn't loaded).
 *
 * #194 (docs/design/197 §3 frames 5–8): Edit, top right, opens the edit sheet;
 * Delete, at the end of the body, asks nothing — it goes back with the amber
 * Undo toast. Both need a connection and nothing is queued. The capture toast
 * host is mounted here too (vet HIGH): this screen covers the tabs, so the
 * offline refusal would otherwise draw underneath it.
 */
export default function PlaceScreen() {
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const { saves, error, reload } = useSaves();
  const { online } = useCaptureState();
  // Delete drops the row from the list at once; the screen keeps drawing it
  // while it animates away rather than flashing "no longer in your library".
  const [gone, setGone] = useState<SavedPlace | null>(null);
  const [editing, setEditing] = useState(false);
  const save = saves?.find((s) => s.id === id) ?? (gone?.id === id ? gone : null);
  const back = () => (router.canGoBack() ? router.back() : router.navigate("/saves"));

  /** Delete (frames 6–8). Offline: the amber refusal, and stay. Online: back
   * first, then DELETE; when it lands, "Removed <name>" with Undo, which
   * re-saves through `restoreSave` and offers View on the new id. */
  const remove = (s: SavedPlace) => {
    if (!online) {
      announceDeleteNeedsSignal();
      return;
    }
    setGone(s);
    back();
    deleteSave(s.id).then(
      () =>
        announceRemoved(s.place.name, () => {
          restoreSave(s)
            .then((created) => announceRestored(() => appRouter.push(`/place/${created.id}`)))
            .catch(() => {});
        }),
      () => announceDeleteNeedsSignal(),
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
        <View style={styles.top}>
          <Pressable onPress={back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.back}>‹ {from || "Back"}</Text>
          </Pressable>
          {save ? (
            <Pressable
              onPress={() => setEditing(true)}
              hitSlop={8}
              accessibilityRole="button"
              style={{ marginLeft: "auto" }}
            >
              <Text style={styles.edit}>Edit</Text>
            </Pressable>
          ) : null}
        </View>
        {save ? (
          <PlaceBody save={save} onDelete={() => remove(save)} />
        ) : saves === null && !error ? (
          <Centered>
            <ActivityIndicator color={C.green} />
          </Centered>
        ) : error && !saves ? (
          <Centered>
            <Text style={{ color: C.ink, fontWeight: "700", fontSize: 17 }}>Couldn’t reach the hub</Text>
            <Muted>{API_URL}</Muted>
            <Muted>{error}</Muted>
            <Button onPress={() => void reload()}>Try again</Button>
          </Centered>
        ) : (
          <Centered>
            <Muted>This place is no longer in your library.</Muted>
          </Centered>
        )}
      </SafeAreaView>
      {/* Mounted only while open, so each open re-seeds from the row and Cancel discards. */}
      {save && editing ? (
        <EditSheet save={save} visible online={online} onClose={() => setEditing(false)} />
      ) : null}
      <CaptureToastHost />
    </View>
  );
}

function PlaceBody({ save, onDelete }: { save: SavedPlace; onDelete: () => void }) {
  const router = useRouter();
  const { trips } = useTrips();
  const details = useDetails(save.place.googlePlaceId);
  const links = navigateLinksForPlace(save.place);
  const trip = trips?.find((t) => t.id === save.tripId) ?? null;
  const tripLine = placeTripLine(save, trip);
  const source = placeSourceLine(save);
  const been = save.status === "been";
  const found = details.state === "found" ? details.place : null;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {/* 1 · what it is */}
      <View style={styles.head}>
        <CategoryTile type={save.type} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name}>{save.place.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {placeScreenMeta(save)}
          </Text>
        </View>
      </View>

      {/* 2 · Go — or, with nothing to navigate to, the locate strip in its slot */}
      {links ? (
        <View style={styles.block}>
          <Text style={styles.kicker}>Go</Text>
          <View style={styles.go3}>
            <GoButton label="Google" url={links.google} />
            <GoButton label="Apple" url={links.apple} />
            <GoButton label="Waze" url={links.waze} />
          </View>
          <View style={styles.go2}>
            {found?.nationalPhoneNumber ? (
              <GoButton sub label="Call" url={placeTelUrl(found.nationalPhoneNumber)} />
            ) : null}
            {found?.websiteUri ? <GoButton sub label="Website" url={found.websiteUri} /> : null}
            <Pressable
              onPress={() => router.navigate({ pathname: "/map", params: { place: save.id } })}
              accessibilityRole="button"
              style={[styles.go, styles.goSub]}
            >
              <Text style={[styles.goText, styles.goSubText]}>On the map</Text>
            </Pressable>
          </View>
        </View>
      ) : save.suggestedPlace ? (
        <Suggestion save={save} />
      ) : null}

      {/* 3 · Yours */}
      <View style={styles.block}>
        <Text style={styles.kicker}>Yours</Text>
        <ShelfSwitch value={save.status} onChange={(status) => void patchSave(save.id, { status }).catch(() => {})} />
        {been || save.note || tripLine || source ? (
          <View style={styles.yours}>
            {been && (
              <View style={styles.yrow}>
                <Stars
                  value={save.rating ?? 0}
                  size={17}
                  onSet={(n) => void patchSave(save.id, { rating: n === 0 ? null : n }).catch(() => {})}
                />
                <View style={{ marginLeft: "auto" }}>
                  <AgainBadge again={save.again} />
                </View>
              </View>
            )}
            {save.note ? <Text style={styles.note}>{save.note}</Text> : null}
            {tripLine && save.tripId ? (
              <Pressable
                onPress={() => router.navigate(`/trips/${save.tripId}`)}
                accessibilityRole="link"
                hitSlop={6}
              >
                <Text style={styles.trip}>{tripLine}</Text>
              </Pressable>
            ) : null}
            {source ? <Text style={styles.source}>{source}</Text> : null}
          </View>
        ) : null}
      </View>

      {/* 4 · What others say */}
      <View style={styles.block}>
        <Text style={styles.kicker}>What others say</Text>
        <GoogleLine details={details} />
        <Doors save={save} />
      </View>

      {/* Delete — the destructive colour, and nothing else wears it (q3 B) */}
      <Pressable onPress={onDelete} accessibilityRole="button" style={styles.del}>
        <Text style={styles.delText}>Delete place</Text>
      </Pressable>
    </ScrollView>
  );
}

/**
 * The edit sheet (frame 5): Name · Category · Note, seeded by core's
 * `savePlaceFormFromSaved` and sent as core's `editPlacePatch` through
 * `patchSave`. Rating and Shelf are NOT here (vet HIGH): `editPlacePatch`
 * never sends status, rating or tripId — the Yours block writes those — so
 * the sheet draws only what it saves, as the web's edit sheet does.
 * Offline (frame 8): the line over Save, and Save does nothing.
 */
function EditSheet({
  save,
  visible,
  online,
  onClose,
}: {
  save: SavedPlace;
  visible: boolean;
  online: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SavePlaceForm>(() => savePlaceFormFromSaved(save));
  const [busy, setBusy] = useState(false);
  const patch = editPlacePatch(form);
  const activeCat = categoryOf(form.type).cat;

  const submit = () => {
    if (!online || !patch || busy) return;
    setBusy(true);
    patchSave(save.id, patch)
      .then(onClose, () => {})
      .finally(() => setBusy(false));
  };
  const setName = (name: string) =>
    setForm((f) => ({ ...f, picked: f.picked ? { ...f.picked, name } : f.picked }));
  // The row picks the category, not the type: a "lodging" row under Stay keeps
  // its own type (the web's PlaceSheet rule).
  const pickType = (t: ReservationType) =>
    setForm((f) => ({ ...f, type: categoryOf(f.type).cat === categoryOf(t).cat ? f.type : t }));

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.eh}>
        <Text style={styles.ehTitle}>Edit place</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
          <Text style={styles.ehCancel}>Cancel</Text>
        </Pressable>
      </View>
      <View style={styles.fld}>
        <Label>Name</Label>
        <Input value={form.picked?.name ?? ""} onChangeText={setName} autoCapitalize="words" />
      </View>
      <View style={styles.fld}>
        <Label>Category</Label>
        <View style={styles.cats}>
          {SAVE_SHEET_TYPES.map((t) => {
            const cat = categoryOf(t).cat;
            return (
              <Chip key={t} neutral on={cat === activeCat} onPress={() => pickType(t)}>
                {cat}
              </Chip>
            );
          })}
        </View>
      </View>
      <View style={styles.fld}>
        <Label>Note</Label>
        <Input
          value={form.note}
          onChangeText={(note) => setForm((f) => ({ ...f, note }))}
          multiline
          autoCapitalize="sentences"
          autoCorrect
        />
      </View>
      {!online ? <Text style={styles.off}>{EDIT_OFFLINE_NOTICE}</Text> : null}
      <Button onPress={submit} disabled={!online || !patch || busy}>
        {online ? "Save" : "Save · offline"}
      </Button>
    </Sheet>
  );
}

/** One Go button. The three-across row is the shipped navy-soft pill
 * (`src/navigate.tsx`), sized up; `sub` is the second row's outlined button. */
function GoButton({ label, url, sub = false }: { label: string; url: string; sub?: boolean }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={[styles.go, sub && styles.goSub]}
    >
      <Text style={[styles.goText, sub && styles.goSubText]}>{label}</Text>
    </Pressable>
  );
}

/** The wireframe's `.pseg`: Been there · Want to go, the chosen half on navy-soft (q6 A). */
function ShelfSwitch({ value, onChange }: { value: SavedPlaceStatus; onChange: (s: SavedPlaceStatus) => void }) {
  const options: { value: SavedPlaceStatus; label: string }[] = [
    { value: "been", label: "Been there" },
    { value: "want", label: "Want to go" },
  ];
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => (on ? undefined : onChange(o.value))}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segHalf, on && styles.segOn]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type DetailsState = { state: "none" } | { state: "checking" } | { state: "found"; place: Details };

/**
 * Google's details for this save, through our own route (never Google directly
 * — the key stays on the server). ONE piece of state keyed by the id it answers
 * for, as the web's GoogleLine keeps it:
 *   ① an answer with a place → found;
 *   ② asked, not answered yet → checking;
 *   ③ no google_place_id → none, and nothing is asked;
 *   ④ no key / a retired id / no signal → the empty answer → none.
 */
function useDetails(googlePlaceId: string | null): DetailsState {
  const [answer, setAnswer] = useState<{ id: string; place: Details | null } | null>(null);
  useEffect(() => {
    if (!googlePlaceId) return;
    let live = true;
    api.places
      .details(googlePlaceId)
      .then((env) => {
        if (live) setAnswer({ id: googlePlaceId, place: env.results[0] ?? null });
      })
      .catch(() => {
        if (live) setAnswer({ id: googlePlaceId, place: null });
      });
    return () => {
      live = false;
    };
  }, [googlePlaceId]);
  if (!googlePlaceId) return { state: "none" };
  if (answer?.id !== googlePlaceId) return { state: "checking" };
  return answer.place ? { state: "found", place: answer.place } : { state: "none" };
}

/** The phone twin of the web's GoogleLine: ① the line, ② "checking…", ③ and ④ nothing. */
function GoogleLine({ details }: { details: DetailsState }) {
  if (details.state === "none") return null;
  if (details.state === "checking") {
    return (
      <View style={styles.gline}>
        <Text style={styles.glText}>G — checking…</Text>
      </View>
    );
  }
  const maps = details.place.googleMapsUri;
  return (
    <View style={styles.gline}>
      <Text style={styles.glText} numberOfLines={1}>
        {placeGoogleLine(details.place)}
      </Text>
      {maps ? (
        <Pressable onPress={() => void Linking.openURL(maps)} accessibilityRole="link" hitSlop={8} style={{ marginLeft: "auto" }}>
          <Text style={styles.glMaps}>Google Maps ↗</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Core's doors, grouped google · social · the category's own word, as text chips (q2 A). */
function Doors({ save }: { save: SavedPlace }) {
  const doors = drillDoors({ name: save.place.name, locality: save.region, type: save.type });
  const groups: DrillGroup[] = ["google", "social", "category"];
  return (
    <View style={styles.doors}>
      {groups.map((g) => {
        const inGroup = doors.filter((d) => d.group === g);
        if (inGroup.length === 0) return null;
        return (
          <View key={g} style={styles.dgrp}>
            <Text style={styles.dlabel}>{drillGroupLabel(g, save.type)}</Text>
            {inGroup.map((d) => (
              <DoorChip key={d.id} door={d} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function DoorChip({ door }: { door: DrillDoor }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(door.url)}
      accessibilityRole="link"
      accessibilityLabel={door.title}
      style={styles.door}
    >
      <Text style={styles.doorText}>
        {door.label}
        {door.badge ? <Text style={styles.doorBadge}> {door.badge}</Text> : null}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surfaceAlt },
  screen: { flex: 1, backgroundColor: C.surfaceAlt },
  // .ptop / .back
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4 },
  back: { fontSize: 12, fontWeight: "600", color: C.accent, paddingVertical: 6 },
  // .ptop .edit
  edit: { fontSize: 13, fontWeight: "700", color: C.accent, paddingVertical: 6 },
  // .pl-body
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 11 },
  // .phd
  head: { flexDirection: "row", alignItems: "center", gap: 11 },
  name: { fontSize: 19, fontWeight: "800", letterSpacing: -0.3, lineHeight: 23, color: C.ink, fontFamily: F.sans },
  meta: {
    fontFamily: F.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: C.inkFaded,
  },
  // .blk / .bk
  block: { gap: 6 },
  kicker: {
    fontFamily: F.mono,
    fontSize: 9.5,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.95,
    color: C.inkFaded,
  },
  // .go3 / .go2 / .gobtn / .gobtn.sub
  go3: { flexDirection: "row", gap: 6 },
  go2: { flexDirection: "row", gap: 6 },
  go: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: R.card,
    paddingVertical: 10,
    backgroundColor: C.navySoft,
  },
  goText: { fontSize: 12.5, fontWeight: "700", color: C.ink },
  goSub: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.borderHi, paddingVertical: 8 },
  goSubText: { fontSize: 11.5, fontWeight: "600" },
  // .pseg
  seg: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    padding: 3,
    gap: 3,
  },
  segHalf: { flex: 1, alignItems: "center", borderRadius: R.md, paddingVertical: 7 },
  segOn: { backgroundColor: C.navySoft },
  segText: { fontSize: 12, fontWeight: "600", color: C.inkMuted },
  segTextOn: { color: C.ink, fontWeight: "700" },
  // .yours
  yours: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    borderRadius: R.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  yrow: { flexDirection: "row", alignItems: "center", gap: 8 },
  note: { fontSize: 12.5, lineHeight: 17.5, color: C.inkMuted },
  trip: { fontSize: 11.5, fontWeight: "700", color: C.accent },
  source: { fontFamily: F.mono, fontSize: 9.5, color: C.inkFaded },
  // .gline
  gline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    borderRadius: R.card,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  glText: { fontFamily: F.mono, fontSize: 11, color: C.inkFaded, flexShrink: 1 },
  glMaps: { fontSize: 11.5, fontWeight: "700", color: C.accent },
  // .doors / .dgrp / .door
  doors: { gap: 5 },
  dgrp: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 },
  dlabel: { width: 44, fontFamily: F.mono, fontSize: 9, color: C.inkFaded },
  door: { borderRadius: R.pill, paddingVertical: 4, paddingHorizontal: 9, backgroundColor: C.navySoft },
  doorText: { fontSize: 10.5, fontWeight: "700", color: C.ink },
  doorBadge: { color: C.inkFaded },
  // .del — Delete, in the destructive colour (q3 B)
  del: { marginTop: 4, padding: 10, alignItems: "center" },
  delText: { fontSize: 12.5, fontWeight: "600", color: C.destructive },
  // .esheet .eh / .fld / .off
  eh: { flexDirection: "row", alignItems: "baseline" },
  ehTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: C.ink },
  ehCancel: { fontSize: 12, fontWeight: "700", color: C.accent },
  fld: { gap: 2 },
  cats: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  off: { fontSize: 10.5, color: C.warning, textAlign: "center" },
});
