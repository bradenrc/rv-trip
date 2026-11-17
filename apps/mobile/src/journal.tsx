import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  ForNextTime,
  HowWasIt,
  IsoDate,
  JournalEarlierGroup,
  JournalEntry,
  NextTimeCard,
  NextTimeRow,
  Reservation,
  RouteDrive,
  Trip,
} from "@rv-trip/core";
import {
  JOURNAL_AROUND_HEADING,
  JOURNAL_EMPTY_COPY,
  activeTrip,
  againBadge,
  journalMap,
  journalToday,
  reservationEntry,
  upNext,
  upNextThenLine,
  dateRange,
  didntGetToLabel,
  journalIsEmpty,
  journalTallyParts,
  nextTimeDatesLine,
  nextTimeKicker,
  nextTimeRowAction,
  toggleAgain,
  travelFoldLabel,
  tripJournal,
} from "@rv-trip/core";
import { Sheet } from "./hops";
import { MapFrame, TripMap, useStyleMode, type TripMapEntry, type TripMapPin } from "./map";
import { NavigateLinks } from "./navigate";
import { C, F, R } from "./theme";
import { Card, CategoryTile, Segmented, Stars, type SegmentedOption } from "./ui";

/**
 * W3 Journal on the phone (#113 · docs/design/113 Screens 1–4): the "How was
 * it?" sheet, the Again / Once was enough pair and badge (Q9 A: Again is
 * ink-muted on border-hi with ↻; Once was enough stays amber), the Journal
 * lens, and the "Last time here" card. Every rule and string is core's
 * (`tripJournal`, `forNextTime` and their copy); this file is layout.
 */

// ── the pair and the badge ──────────────────────────────────────────────────

/** "Do it again?" — Again / Once was enough. Tapping the lit one clears it
 * back to not said (`toggleAgain`). */
export function AgainPair({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <View style={styles.seg2}>
      {([true, false] as const).map((v) => {
        const on = value === v;
        const once = v === false;
        return (
          <Pressable
            key={String(v)}
            onPress={() => onChange(toggleAgain(value, v))}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[
              styles.seg2Btn,
              on && (once ? styles.seg2OnOnce : styles.seg2On),
            ]}
          >
            <Text style={[styles.seg2Text, on && { color: once ? C.warning : C.ink }]}>
              {once ? "⊖" : "↻"} {once ? "Once was enough" : "Again"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The row's badge: "↻ again" or amber "⊖ once was enough"; nothing when not said. */
export function AgainBadge({ again }: { again: boolean | null }) {
  const b = againBadge(again);
  if (!b) return null;
  return (
    <View style={[styles.badge, b.once && styles.badgeOnce]}>
      <Text style={[styles.badgeText, b.once && { color: C.warning }]}>
        {b.once ? "⊖" : "↻"} {b.label}
      </Text>
    </View>
  );
}

/** The green "✓ done" badge the sheet wears after a check. */
function DoneBadge() {
  return (
    <View style={[styles.badge, { borderColor: C.green, backgroundColor: C.greenSoft }]}>
      <Text style={[styles.badgeText, { color: C.greenInk }]}>✓ done</Text>
    </View>
  );
}

/** A logged row's second line: its ★, its badge. */
export function LoggedMeta({ rating, again }: { rating: number | null; again: boolean | null }) {
  if (rating === null && again === null) return null;
  return (
    <View style={styles.meta}>
      {rating !== null && <Stars value={rating} size={10} />}
      <AgainBadge again={again} />
    </View>
  );
}

// ── the "How was it?" sheet ─────────────────────────────────────────────────

/**
 * The check-off's optional sheet (Q3 B): ★ at 28, Again / Once was enough and
 * a note. One tap on the circle has already committed the check, so every
 * control is optional and DISMISSING the sheet counts as Skip. A reservation's
 * "How was it?" pill opens the same sheet without the done badge.
 */
export function HowWasItSheet({
  visible,
  name,
  done,
  initial,
  onLog,
  onSkip,
}: {
  visible: boolean;
  name: string;
  /** Opened by a check (the "✓ done" badge and the Skip link). */
  done: boolean;
  initial: HowWasIt;
  onLog: (v: HowWasIt) => void;
  /** Skip, or the sheet dismissed. */
  onSkip: () => void;
}) {
  const [rating, setRating] = useState(initial.rating ?? 0);
  const [again, setAgain] = useState<boolean | null>(initial.again);
  const [notes, setNotes] = useState(initial.notes ?? "");
  useEffect(() => {
    if (!visible) return;
    setRating(initial.rating ?? 0);
    setAgain(initial.again);
    setNotes(initial.notes ?? "");
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet visible={visible} onClose={onSkip}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {done && <DoneBadge />}
        <Text style={styles.sheetTitle}>How was it?</Text>
      </View>
      <Text style={styles.sheetSub}>{name} · all optional</Text>
      <Stars value={rating} size={28} onSet={setRating} />
      <Text style={styles.lbl}>Do it again?</Text>
      <AgainPair value={again} onChange={setAgain} />
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="For next time…"
        placeholderTextColor={C.inkSubtle}
        style={styles.ta}
        selectionColor={C.green}
      />
      <LogCta
        onPress={() =>
          onLog({ rating: rating === 0 ? null : rating, again, notes: notes.trim() === "" ? null : notes.trim() })
        }
      />
      {done && (
        <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.skip}>Skip — just check it off</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

/** "✓ Log it" — the green-cta the capture sheet's Save is. The capture sheet
 * mid-trip passes core's `logCtaLabel` ("Save to Pacific Northwest Loop");
 * the ✓ is the phone's own (#176 · the web footer draws none). */
export function LogCta({ onPress, label = "Log it" }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
      <Text style={styles.ctaText}>✓ {label}</Text>
    </Pressable>
  );
}

// ── the Journal lens ────────────────────────────────────────────────────────

/**
 * Route · Map · Journal's third lens (Q4 B): one core read, `tripJournal`.
 * The trip card is `trips.rating` / `trips.note`, edited in place; tapping a
 * row opens the "How was it?" sheet for that thing (`onOpen`).
 *
 * #178 · #181 i4 (q3 B · q4 B · q5 A · q8 A, docs/design/181 frame 3) — while
 * the trip's dates cover today (`activeTrip`), the Journal leads with Up next
 * (`upNext`), Today and Earlier (`journalToday`) and the green Log something
 * (`onLog` → the TL2 capture sheet). "Whole trip and map →" swaps the shipped
 * whole-trip Journal in place, for this visit only, and "‹ Today" swaps back.
 */
export function JournalView({
  trip,
  today,
  now,
  drives,
  onRateTrip,
  onNoteTrip,
  onOpen,
  onLog,
}: {
  trip: Trip;
  today: IsoDate;
  now: Date;
  /** The route's drives by segment (core's `routeDrives`) — Navigate on Up next. */
  drives: ReadonlyMap<string, RouteDrive>;
  onRateTrip: (n: number) => void;
  onNoteTrip: (note: string) => void;
  onOpen: (entry: JournalEntry) => void;
  /** Log something — the capture sheet, filed under today's destination. */
  onLog: () => void;
}) {
  const [whole, setWhole] = useState(false);
  const midTrip = activeTrip([trip], today) !== null;
  return midTrip && !whole ? (
    <JournalTodayView
      trip={trip}
      today={today}
      now={now}
      drives={drives}
      onOpen={onOpen}
      onLog={onLog}
      onWhole={() => setWhole(true)}
    />
  ) : (
    <WholeTripJournal
      trip={trip}
      today={today}
      onRateTrip={onRateTrip}
      onNoteTrip={onNoteTrip}
      onOpen={onOpen}
      onToday={midTrip ? () => setWhole(false) : null}
    />
  );
}

/** The mid-trip form: Up next, Today, Log something, Earlier. */
function JournalTodayView({
  trip,
  today,
  now,
  drives,
  onOpen,
  onLog,
  onWhole,
}: {
  trip: Trip;
  today: IsoDate;
  now: Date;
  drives: ReadonlyMap<string, RouteDrive>;
  onOpen: (entry: JournalEntry) => void;
  onLog: () => void;
  onWhole: () => void;
}) {
  const up = upNext(trip, now, today);
  const j = journalToday(trip, today);
  const names = new Map(trip.chapters.flatMap((c) => c.destinations).map((d) => [d.id, d.place.name] as const));
  const nextDrive = up ? (drives.get(up.next.segmentId ?? "") ?? null) : null;
  // Only a drive's segment is in `drives` (a flight or a ferry has no road), so
  // a fly or ferry "then" finds nothing and carries no Navigate.
  const thenDrive = up?.then ? (drives.get(up.then.segmentId ?? "") ?? null) : null;
  const todayEmpty = j.today.entries.length === 0 && j.today.toRate.length === 0;

  return (
    <View style={{ gap: 8 }}>
      {up && (
        <>
          <Text style={styles.sect}>Up next</Text>
          <View style={styles.upnext}>
            <View style={styles.ut}>
              <Text style={styles.utTitle}>{up.next.title}</Text>
              <Text style={styles.when}>{up.next.when}</Text>
            </View>
            {up.next.navTo && nextDrive && (
              <NavigateLinks drive={nextDrive} rigOn={trip.rigOn} toName={names.get(nextDrive.toDestinationId) ?? ""} fromName={names.get(nextDrive.fromDestinationId) ?? ""} />
            )}
            {up.then && <Text style={styles.then}>{upNextThenLine(up.then)}</Text>}
            {thenDrive && (
              <NavigateLinks drive={thenDrive} rigOn={trip.rigOn} toName={names.get(thenDrive.toDestinationId) ?? ""} fromName={names.get(thenDrive.fromDestinationId) ?? ""} />
            )}
          </View>
        </>
      )}
      <Text style={[styles.sect, styles.sectToday]}>{j.today.heading}</Text>
      {todayEmpty ? (
        <View style={styles.rows}>
          <Text style={styles.empty}>Nothing logged here yet.</Text>
        </View>
      ) : (
        <EntryRows entries={j.today.entries} toRate={j.today.toRate} onOpen={onOpen} />
      )}
      <Pressable onPress={onLog} accessibilityRole="button" style={({ pressed }) => [styles.logCta, pressed && { opacity: 0.85 }]}>
        <Text style={styles.logCtaText}>＋ Log something</Text>
      </Pressable>
      {j.earlier.length > 0 && <Text style={styles.sect}>Earlier</Text>}
      {j.earlier.map((g) => (
        <EarlierGroup key={g.destination?.id ?? "around"} group={g} onOpen={onOpen} />
      ))}
      <Pressable onPress={onWhole} accessibilityRole="button" hitSlop={6}>
        <Text style={styles.jump}>Whole trip and map →</Text>
      </Pressable>
    </View>
  );
}

/** A past destination under Earlier: the shipped group head, then its rows. */
function EarlierGroup({ group: g, onOpen }: { group: JournalEarlierGroup; onOpen: (e: JournalEntry) => void }) {
  const d = g.destination;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.dayhd}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, flexWrap: "wrap" }}>
          <Text style={styles.dayName}>{g.heading}</Text>
          {g.rating !== null && <Stars value={g.rating} size={10} />}
          <AgainBadge again={g.again} />
        </View>
        {d?.arriveDate && d.departDate ? <Text style={styles.dayDates}>{dateRange(d.arriveDate, d.departDate)}</Text> : null}
      </View>
      {(g.entries.length > 0 || g.toRate.length > 0) && (
        <EntryRows entries={g.entries} toRate={g.toRate} onOpen={onOpen} />
      )}
    </View>
  );
}

// ── #179 · the whole-trip Journal's map ─────────────────────────────────────

/** Map · List only, remembered on the device — the STYLE_PREF_KEY pattern
 * (src/map.tsx). */
export const JOURNAL_MAP_PREF_KEY = "rv-journal-map";

type JournalMapChoice = "map" | "list";

const JOURNAL_MAP_SEGMENTS: SegmentedOption<JournalMapChoice>[] = [
  { value: "map", label: "Map" },
  { value: "list", label: "List only" },
];

/** docs/design/181 frame 4. */
const JOURNAL_MAP_HEIGHT = 196;

/**
 * The persisted Map · List only choice. `null` until AsyncStorage answers (the
 * loading frame covers that one render); anything but "list" reads as Map, so
 * the first visit opens on the map (q7 A).
 */
function useJournalMapChoice(): [JournalMapChoice | null, (c: JournalMapChoice) => void] {
  const [choice, setChoice] = useState<JournalMapChoice | null>(null);
  useEffect(() => {
    let live = true;
    const settle = (raw: string | null) => {
      if (live) setChoice(raw === "list" ? "list" : "map");
    };
    AsyncStorage.getItem(JOURNAL_MAP_PREF_KEY)
      .then(settle)
      .catch(() => settle(null));
    return () => {
      live = false;
    };
  }, []);
  const choose = useCallback((next: JournalMapChoice) => {
    setChoice(next);
    void AsyncStorage.setItem(JOURNAL_MAP_PREF_KEY, next).catch(() => {
      // A failed write costs next launch's preference, never this tap.
    });
  }, []);
  return [choice, choose];
}

/**
 * The map above the whole-trip Journal (q5 A · q7 A): core's `journalMap`
 * through the shipped TripMap — hollow discs for been, small category discs for
 * logged places, the dashed join — with the mono Map · List only pill over it.
 * No request is made. List only is the pill alone above the list.
 */
function JournalMapBlock({
  trip,
  today,
  selectedId,
  setSelectedId,
}: {
  trip: Trip;
  today: IsoDate;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
}) {
  const [choice, setChoice] = useJournalMapChoice();
  const [mode] = useStyleMode();
  const m = useMemo(() => journalMap(trip, today), [trip, today]);
  const pins = useMemo<TripMapPin[]>(
    () =>
      m.points
        .filter((p) => p.kind === "destination")
        .map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, ordinal: p.ordinal, floating: p.ordinal === null, been: p.been })),
    [m],
  );
  const entries = useMemo<TripMapEntry[]>(
    () => m.points.filter((p) => p.kind === "entry").map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, category: p.category })),
    [m],
  );

  if (choice === "list") {
    return <Segmented mono value={choice} options={JOURNAL_MAP_SEGMENTS} onChange={setChoice} />;
  }
  return (
    <View style={styles.mapBox}>
      {choice === null || mode === null ? (
        <MapFrame state="loading" height={JOURNAL_MAP_HEIGHT} />
      ) : (
        <TripMap pins={pins} entries={entries} join={m.join} mode={mode} showLabels={false} height={JOURNAL_MAP_HEIGHT} selectedId={selectedId} onSelect={setSelectedId} />
      )}
      {choice !== null && (
        <View style={styles.mapSeg}>
          <Segmented mono value={choice} options={JOURNAL_MAP_SEGMENTS} onChange={setChoice} />
        </View>
      )}
    </View>
  );
}

/** The shipped whole-trip Journal; mid-trip it opens with "‹ Today". Above
 * it, the Journal map (#179). */
function WholeTripJournal({
  trip,
  today,
  onRateTrip,
  onNoteTrip,
  onOpen,
  onToday,
}: {
  trip: Trip;
  today: IsoDate;
  onRateTrip: (n: number) => void;
  onNoteTrip: (note: string) => void;
  onOpen: (entry: JournalEntry) => void;
  /** Mid-trip only: back to the Today form. */
  onToday: (() => void) | null;
}) {
  const j = tripJournal(trip);
  const [note, setNote] = useState(trip.note ?? "");
  const [open, setOpen] = useState({ skipped: false, travel: false });
  // #179 · a pin lights its row or heading; a row or heading lights its pin.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setNote(trip.note ?? ""), [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 8 }}>
      {onToday && (
        <Pressable onPress={onToday} accessibilityRole="button" hitSlop={6} style={{ alignSelf: "flex-start" }}>
          <Text style={[styles.jump, styles.jumpLeft]}>‹ Today</Text>
        </Pressable>
      )}
      {!journalIsEmpty(j) && (
        <JournalMapBlock trip={trip} today={today} selectedId={selectedId} setSelectedId={setSelectedId} />
      )}
      <Card style={{ paddingVertical: 10, paddingHorizontal: 11, gap: 4 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={styles.lbl}>The trip</Text>
          <Stars value={trip.rating ?? 0} size={12} onSet={onRateTrip} />
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          onBlur={() => {
            if (note !== (trip.note ?? "")) onNoteTrip(note);
          }}
          multiline
          placeholder="What to remember for next time…"
          placeholderTextColor={C.inkSubtle}
          style={styles.tripNote}
          selectionColor={C.green}
        />
      </Card>
      {journalIsEmpty(j) ? (
        <Text style={{ color: C.inkFaded, fontSize: 12.5 }}>{JOURNAL_EMPTY_COPY}</Text>
      ) : (
        <View style={styles.tally}>
          {journalTallyParts(j.tally).map((p) => (
            <Text key={p.label} style={styles.tallyText}>
              <Text style={{ color: C.ink, fontWeight: "700" }}>{p.n}</Text> {p.label}
            </Text>
          ))}
        </View>
      )}
      {j.destinations.map((g) => (
        <View key={g.destination.id} style={{ gap: 8 }}>
          <Pressable
            onPress={() => setSelectedId(g.destination.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: g.destination.id === selectedId }}
            style={[styles.dayhd, g.destination.id === selectedId && styles.sel]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, flexWrap: "wrap" }}>
              <Text style={styles.dayName}>{g.destination.place.name}</Text>
              {g.rating !== null && <Stars value={g.rating} size={10} />}
              <AgainBadge again={g.again} />
            </View>
            {g.destination.arriveDate && g.destination.departDate ? (
              <Text style={styles.dayDates}>{dateRange(g.destination.arriveDate, g.destination.departDate)}</Text>
            ) : null}
          </Pressable>
          {g.entries.length > 0 && (
            <EntryRows entries={g.entries} onOpen={onOpen} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </View>
      ))}
      {j.around.length > 0 && (
        <View style={{ gap: 8 }}>
          <View style={styles.dayhd}>
            <Text style={styles.dayName}>{JOURNAL_AROUND_HEADING}</Text>
          </View>
          <EntryRows entries={j.around} onOpen={onOpen} selectedId={selectedId} onSelect={setSelectedId} />
        </View>
      )}
      {j.didntGetTo.length > 0 && (
        <Fold
          label={didntGetToLabel(j.didntGetTo.length)}
          items={j.didntGetTo.map((i) => i.title)}
          open={open.skipped}
          onToggle={() => setOpen((o) => ({ ...o, skipped: !o.skipped }))}
        />
      )}
      {j.travel.length > 0 && (
        <Fold
          label={travelFoldLabel(trip, j.travel)}
          items={j.travel.map((r) => r.name)}
          open={open.travel}
          onToggle={() => setOpen((o) => ({ ...o, travel: !o.travel }))}
        />
      )}
    </View>
  );
}

function EntryRows({
  entries,
  toRate = [],
  onOpen,
  selectedId = null,
  onSelect,
}: {
  entries: JournalEntry[];
  /** #178 · rows still waiting on a rating — each carries a "How was it?" pill. */
  toRate?: Reservation[];
  onOpen: (e: JournalEntry) => void;
  /** #179 · the whole-trip map's selection: a tapped row lights its pin. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <View style={styles.rows}>
      {toRate.map((r, i) => (
        <View key={`rate:${r.id}`} style={[styles.row, i > 0 && styles.rowRule]}>
          <CategoryTile type={r.type} size={26} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.rn}>{r.name}</Text>
          </View>
          <Pressable onPress={() => onOpen(reservationEntry(r))} accessibilityRole="button" hitSlop={6} style={styles.how}>
            <Text style={styles.howText}>How was it?</Text>
          </Pressable>
        </View>
      ))}
      {entries.map((e, i) => (
        <Pressable
          key={`${e.kind}:${e.id}`}
          onPress={() => {
            onSelect?.(e.id);
            onOpen(e);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.row,
            (i > 0 || toRate.length > 0) && styles.rowRule,
            e.id === selectedId && styles.sel,
            pressed && { opacity: 0.85 },
          ]}
        >
          <CategoryTile type={e.type} size={26} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.rn}>{e.name}</Text>
            <LoggedMeta rating={e.rating} again={e.again} />
            {e.notes ? <Text style={styles.rq}>{e.notes}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** A dashed fold — collapsed to one line, expanding in place. */
function Fold({ label, items, open, onToggle }: { label: string; items: string[]; open: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.fold}>
      <Text style={styles.foldText} numberOfLines={open ? undefined : 1}>
        <Text style={{ color: C.inkMuted, fontWeight: "700" }}>{label}</Text>
        {open ? "" : `: ${items.join(" · ")} ▸`}
      </Text>
      {open && items.map((name, i) => <Text key={i} style={styles.foldText}>{name}</Text>)}
    </Pressable>
  );
}

// ── "Last time here" ────────────────────────────────────────────────────────

/** One card per past trip × area, directly above the nearby banner. No
 * card is the empty state: nothing renders. */
export function LastTimeHere({
  nextTime,
  onAdd,
}: {
  nextTime: ForNextTime | null;
  onAdd: (row: NextTimeRow) => void;
}) {
  if (!nextTime || nextTime.cards.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {nextTime.cards.map((card) => (
        <LastTimeCard key={`${card.pastTrip.id}:${card.area.id ?? card.destination.id}`} card={card} onAdd={onAdd} />
      ))}
    </View>
  );
}

function LastTimeCard({ card, onAdd }: { card: NextTimeCard; onAdd: (row: NextTimeRow) => void }) {
  const row = (r: NextTimeRow, group: "again" | "once") => {
    const action = nextTimeRowAction(r, group);
    return (
      <View key={r.saveId} style={[styles.row, styles.rowRule]}>
        <CategoryTile type={r.type} size={26} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rn}>{r.name}</Text>
          <LoggedMeta rating={r.rating} again={r.again} />
          {r.note ? (
            <Text style={styles.rq} numberOfLines={2}>
              {r.note}
            </Text>
          ) : null}
        </View>
        {action === "Add" ? (
          <AddButton onPress={() => onAdd(r)}>Add</AddButton>
        ) : action ? (
          <View style={[styles.addbtn, styles.addbtnOn]}>
            <Text style={[styles.addbtnText, { color: C.greenInk }]}>{action}</Text>
          </View>
        ) : null}
      </View>
    );
  };
  return (
    <View style={styles.lasttime}>
      <View style={styles.lh}>
        <Text style={[styles.lbl, { color: C.inkMuted }]}>{nextTimeKicker(card)}</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
          <Text style={{ color: C.ink, fontSize: 13.5, fontWeight: "700", flexShrink: 1 }}>{card.pastTrip.title}</Text>
          {card.pastTrip.rating !== null && <Stars value={card.pastTrip.rating} size={10} />}
        </View>
        <Text style={styles.mono}>{nextTimeDatesLine(card)}</Text>
        {card.pastTrip.note ? <Text style={styles.tq}>“{card.pastTrip.note}”</Text> : null}
      </View>
      {card.again.map((r) => row(r, "again"))}
      {card.once.map((r) => row(r, "once"))}
    </View>
  );
}

function AddButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6} style={styles.addbtn}>
      <Text style={styles.addbtnText}>{children}</Text>
    </Pressable>
  );
}

// docs/design/113's `.seg2`, `.badge`, `.sheet`, `.rows`, `.fold`, `.lasttime`.
const styles = StyleSheet.create({
  seg2: { flexDirection: "row", gap: 6 },
  seg2Btn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: R.card,
    borderWidth: 1.5,
    borderColor: C.borderHi,
    backgroundColor: C.surface,
  },
  seg2On: { borderColor: C.ink, backgroundColor: C.navySoft },
  seg2OnOnce: { borderColor: C.warning, backgroundColor: C.warningSoft },
  seg2Text: { fontSize: 12.5, fontWeight: "600", color: C.inkMuted },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: C.borderHi,
    backgroundColor: C.surface,
    borderRadius: R.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  badgeOnce: { borderColor: C.warning, backgroundColor: C.warningSoft },
  badgeText: {
    fontFamily: F.mono,
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.45,
    color: C.inkMuted,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  sheetTitle: { fontSize: 15, fontWeight: "800", color: C.ink },
  sheetSub: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
  lbl: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: C.inkFaded,
  },
  ta: {
    fontSize: 12.5,
    color: C.ink,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.md,
    paddingHorizontal: 9,
    paddingVertical: 7,
    minHeight: 40,
    lineHeight: 17,
    textAlignVertical: "top",
  },
  cta: { alignItems: "center", justifyContent: "center", backgroundColor: C.green, borderRadius: R.card, paddingVertical: 11 },
  ctaText: { color: C.navy, fontWeight: "800", fontSize: 14 },
  skip: { textAlign: "center", fontSize: 12, color: C.inkFaded, textDecorationLine: "underline" },
  tripNote: { fontSize: 12, color: C.inkMuted, fontStyle: "italic", lineHeight: 17, padding: 0, marginTop: 4 },
  tally: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tallyText: { fontFamily: F.mono, fontSize: 9.5, color: C.inkFaded },
  dayhd: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 2, paddingTop: 4, gap: 8 },
  dayName: { fontSize: 13, fontWeight: "700", color: C.ink },
  dayDates: { fontFamily: F.mono, fontSize: 9.5, color: C.inkFaded },
  rows: { borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden", backgroundColor: C.surface },
  row: { flexDirection: "row", gap: 9, alignItems: "flex-start", paddingHorizontal: 10, paddingVertical: 8, backgroundColor: C.surface },
  rowRule: { borderTopWidth: 1, borderTopColor: C.borderSoft },
  rn: { fontSize: 12.5, fontWeight: "700", color: C.ink, lineHeight: 16 },
  rq: { fontSize: 11.5, color: C.inkMuted, marginTop: 2, lineHeight: 15.5 },
  fold: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.borderHi,
    borderRadius: R.card,
    paddingHorizontal: 9,
    paddingVertical: 6,
    gap: 2,
  },
  foldText: { fontSize: 11, color: C.inkFaded },
  lasttime: {
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.card,
    backgroundColor: C.surface,
    overflow: "hidden",
    // shadow-rv-md
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  lh: { paddingHorizontal: 11, paddingTop: 9, paddingBottom: 8, gap: 1 },
  mono: { fontFamily: F.mono, fontSize: 9.5, color: C.inkFaded },
  tq: { fontSize: 11.5, color: C.inkMuted, fontStyle: "italic", marginTop: 3 },
  addbtn: {
    alignSelf: "center",
    borderRadius: R.md,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: C.green,
  },
  addbtnOn: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.green },
  addbtnText: { fontSize: 10.5, fontWeight: "800", color: C.navy },
  // #178 · docs/design/181 frame 3: `.sect`, `.upnext`, `.log`, `.jump`, `.how`, `.empty`.
  sect: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 0.95,
    color: C.inkFaded,
    paddingHorizontal: 2,
    paddingTop: 4,
  },
  sectToday: { color: C.ink, fontWeight: "700" },
  upnext: {
    borderWidth: 1,
    borderColor: C.borderHi,
    backgroundColor: C.surface,
    borderRadius: R.card,
    paddingVertical: 10,
    paddingHorizontal: 11,
    gap: 7,
    // shadow-rv-sm
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  ut: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  utTitle: { flex: 1, fontSize: 13.5, fontWeight: "700", color: C.ink, lineHeight: 17.5 },
  when: { fontFamily: F.mono, fontSize: 10, color: C.inkMuted, textTransform: "uppercase" },
  then: {
    fontFamily: F.mono,
    fontSize: 9.5,
    textTransform: "uppercase",
    letterSpacing: 0.57,
    color: C.inkFaded,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    paddingTop: 6,
  },
  empty: { fontSize: 11.5, color: C.inkFaded, paddingHorizontal: 10, paddingVertical: 8 },
  logCta: { alignItems: "center", justifyContent: "center", backgroundColor: C.green, borderRadius: R.card, padding: 11 },
  logCtaText: { color: C.navy, fontWeight: "800", fontSize: 14 },
  jump: { fontSize: 11.5, fontWeight: "700", color: C.greenInk, textAlign: "center", padding: 6, textDecorationLine: "underline" },
  jumpLeft: { textAlign: "left", padding: 0 },
  how: {
    alignSelf: "center",
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  howText: { fontSize: 10.5, fontWeight: "700", color: C.greenInk },
  // #179 · docs/design/181 frame 4: `.mapbox`, `.mapbox .seg`, `.row.sel`.
  mapBox: { position: "relative", borderWidth: 1, borderColor: C.border, borderRadius: R.card, overflow: "hidden" },
  mapSeg: { position: "absolute", left: 8, top: 8 },
  sel: { backgroundColor: C.navySoft, borderLeftWidth: 3, borderLeftColor: C.ink },
});
