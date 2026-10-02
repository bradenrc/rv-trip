import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ForNextTime, HowWasIt, JournalEntry, NextTimeCard, NextTimeRow, Trip } from "@rv-trip/core";
import {
  JOURNAL_AROUND_HEADING,
  JOURNAL_EMPTY_COPY,
  againBadge,
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
import { C, F, R } from "./theme";
import { Card, CategoryTile, Stars } from "./ui";

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

/** "✓ Log it" — the green-cta the capture sheet's Save is. */
export function LogCta({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
      <Text style={styles.ctaText}>✓ Log it</Text>
    </Pressable>
  );
}

// ── the Journal lens ────────────────────────────────────────────────────────

/**
 * Route · Map · Journal's third lens (Q4 B): one core read, `tripJournal`.
 * The trip card is `trips.rating` / `trips.note`, edited in place; tapping a
 * row opens the "How was it?" sheet for that thing (`onOpen`).
 */
export function JournalView({
  trip,
  onRateTrip,
  onNoteTrip,
  onOpen,
}: {
  trip: Trip;
  onRateTrip: (n: number) => void;
  onNoteTrip: (note: string) => void;
  onOpen: (entry: JournalEntry) => void;
}) {
  const j = tripJournal(trip);
  const [note, setNote] = useState(trip.note ?? "");
  const [open, setOpen] = useState({ skipped: false, travel: false });
  useEffect(() => setNote(trip.note ?? ""), [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 8 }}>
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
          <View style={styles.dayhd}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, flexWrap: "wrap" }}>
              <Text style={styles.dayName}>{g.destination.place.name}</Text>
              {g.rating !== null && <Stars value={g.rating} size={10} />}
              <AgainBadge again={g.again} />
            </View>
            {g.destination.arriveDate && g.destination.departDate ? (
              <Text style={styles.dayDates}>{dateRange(g.destination.arriveDate, g.destination.departDate)}</Text>
            ) : null}
          </View>
          {g.entries.length > 0 && <EntryRows entries={g.entries} onOpen={onOpen} />}
        </View>
      ))}
      {j.around.length > 0 && (
        <View style={{ gap: 8 }}>
          <View style={styles.dayhd}>
            <Text style={styles.dayName}>{JOURNAL_AROUND_HEADING}</Text>
          </View>
          <EntryRows entries={j.around} onOpen={onOpen} />
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

function EntryRows({ entries, onOpen }: { entries: JournalEntry[]; onOpen: (e: JournalEntry) => void }) {
  return (
    <View style={styles.rows}>
      {entries.map((e, i) => (
        <Pressable
          key={`${e.kind}:${e.id}`}
          onPress={() => onOpen(e)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.row, i > 0 && styles.rowRule, pressed && { opacity: 0.85 }]}
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
});
