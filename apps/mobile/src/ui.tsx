import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { DateRangeValue, DateSpan, ReservationType } from "@rv-trip/core";
import {
  categoryOf,
  dayCellState,
  isCompleteRange,
  monthGrid,
  monthOf,
  monthTitle,
  nightsLabel,
  pickDay,
  rangeLabel,
  rangePickState,
  shiftMonth,
  spanLabel,
} from "@rv-trip/core";
import { C, F, R } from "./theme";

/** Mono uppercase kicker — the DS's label convention. */
export function Kicker({ children, color = C.inkFaded, style }: { children: ReactNode; color?: string; style?: ViewStyle }) {
  return (
    <Text style={[styles.kicker, { color }, style as never]} numberOfLines={1}>
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({ children, color, bg }: { children: ReactNode; color: string; bg?: string }) {
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: bg ?? "transparent" }]}>
      <Text style={[styles.pillText, { color }]}>{children}</Text>
    </View>
  );
}

/** The neutral "estimate" chip — an unfinished measurement, never amber. */
export function EstimateChip() {
  return (
    <View style={styles.estimate}>
      <Text style={styles.estimateText}>ESTIMATE</Text>
    </View>
  );
}

export function FloatingTag() {
  return <Pill color={C.warning}>Floating</Pill>;
}

/** 1–5 stars. `onSet` makes them tappable; tapping the current value clears. */
export function Stars({ value, size = 16, onSet }: { value: number; size?: number; onSet?: (n: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          disabled={!onSet}
          onPress={() => onSet?.(n === value ? 0 : n)}
          hitSlop={6}
          accessibilityRole={onSet ? "button" : undefined}
          accessibilityLabel={`${n} star${n === 1 ? "" : "s"}`}
        >
          <Text style={{ fontSize: size, color: n <= value ? C.accent : C.borderHi, lineHeight: size + 4 }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The category tile: a two-letter mark on the category's soft fill. */
export function CategoryTile({ type, size = 34 }: { type: ReservationType; size?: number }) {
  const m = categoryOf(type);
  const mark = { Stay: "St", Eat: "Ea", Do: "Do", Travel: "Tr", Other: "··" }[m.cat];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: R.md,
        backgroundColor: m.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: F.mono, fontSize: 11, fontWeight: "700", color: m.ink }}>{mark}</Text>
    </View>
  );
}

export function Button({
  children,
  onPress,
  tone = "accent",
  disabled = false,
}: {
  children: ReactNode;
  onPress: () => void;
  tone?: "accent" | "ghost";
  /** Dims and deadens the button — an in-flight submit, or an incomplete field. */
  disabled?: boolean;
}) {
  const accent = tone === "accent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        accent ? { backgroundColor: pressed ? C.accentBright : C.accent } : { borderWidth: 1, borderColor: C.borderHi },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.buttonText, { color: accent ? C.navy : C.ink }]}>{children}</Text>
    </Pressable>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The RN mirror of @rv-trip/ui's `SegmentedControl`
 * (packages/ui/src/Places.tsx:114-153) — the trip masthead's Route ⇄ Map lens,
 * and the over-canvas Night/Day/Sat pill in its `mono` variant.
 *
 * Label-only, deliberately: the web's variant takes a `LucideIcon` and this kit
 * ships no icon set (its marks are glyphs — `CategoryTile`'s two letters, the
 * idea bullets). Every metric is `SegmentedControl`'s, resolved from Tailwind:
 * container `gap-0.5 rounded-rv-pill border border-rv-border bg-rv-surface-alt
 * p-[3px]` (:130), segment `px-3.5 py-1.5 text-[13px] font-bold` (:142) and the
 * mono variant `px-2.5 py-[5px] font-mono text-[11px]` (:142), active
 * `bg-rv-surface text-rv-ink shadow-rv-sm` / inactive `text-rv-ink-faded`
 * (:143). That is the one source for these numbers: the trip masthead's own
 * `ToggleTab` (TripPlanner.tsx:1433-1453) is a different control at a different
 * size and is NOT what this mirrors.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  mono = false,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** The compact mono variant: mono type one step down, tighter padding. For a
   * pill that sits *over* a surface rather than in a control row. */
  mono?: boolean;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segment, mono && styles.segmentMono, on && styles.segmentOn]}
          >
            <Text
              style={[
                styles.segmentText,
                mono && styles.segmentTextMono,
                { color: on ? C.ink : C.inkFaded },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A chip — docs/design/111's `.chip`: mono 10/600 on a pill. `on` is the
 * chosen one (rv-green on green-soft: "verified / chosen"); `warn` is amber
 * ("attention" — the Saves tab's queue count).
 */
export function Chip({
  children,
  on = false,
  warn = false,
  onPress,
}: {
  children: ReactNode;
  on?: boolean;
  warn?: boolean;
  onPress?: () => void;
}) {
  const tone = on
    ? { borderColor: C.green, backgroundColor: C.greenSoft, color: C.greenInk }
    : warn
      ? { borderColor: C.warning, backgroundColor: C.warningSoft, color: C.warning }
      : { borderColor: C.borderHi, backgroundColor: C.surface, color: C.inkMuted };
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      style={[styles.chip, { borderColor: tone.borderColor, backgroundColor: tone.backgroundColor }]}
    >
      <Text style={[styles.chipText, { color: tone.color }]}>{children}</Text>
    </Pressable>
  );
}

/**
 * The capture toast (docs/design/111 `.toast`). Green = verified — "Saved
 * El Chandelier", "Synced 2 saves". Amber = attention — "Saved on this phone",
 * and the sheet's offline strip. A native-local pattern: `packages/ui` is
 * web-only, and promoting this into the DS is a later decision.
 */
export function Toast({
  title,
  sub,
  tone,
  glyph,
  onUndo,
}: {
  title: string;
  sub?: string | null;
  tone: "green" | "amber";
  glyph: string;
  onUndo?: () => void;
}) {
  const amber = tone === "amber";
  const color = amber ? C.warning : C.greenInk;
  return (
    <View
      style={[
        styles.toast,
        amber
          ? { borderColor: C.warning, backgroundColor: C.warningSoft }
          : { borderColor: C.green, backgroundColor: C.greenSoft },
      ]}
      accessibilityRole="alert"
    >
      <Text style={[styles.toastGlyph, { color }]}>{glyph}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.toastTitle, { color }]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={styles.toastSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {onUndo && (
        <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.toastUndo, { color }]}>Undo</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>{children}</View>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: C.inkMuted, fontSize: 14, textAlign: "center", lineHeight: 20 }}>{children}</Text>;
}

/**
 * The phone twin of @rv-trip/ui's `RangePicker` (#127 · Q6 A · Q7 B) — the same
 * core arithmetic (`date-range.ts`), so the month, the nights and the amber
 * guard read identically on both. Trip span `navySoft`, the pick `green` /
 * `greenSoft`, outside the trip `warning` / `warningSoft`; an outside pick
 * offers "Extend trip to …" (`onExtendTrip`). No `tripSpan` = no band.
 */
export function RangePicker({
  value,
  tripSpan = null,
  onChange,
  onExtendTrip,
}: {
  value: DateRangeValue;
  tripSpan?: DateSpan | null;
  onChange: (v: DateRangeValue) => void;
  onExtendTrip?: (span: DateSpan) => void;
}) {
  const [month, setMonth] = useState(() =>
    monthOf(value.start ?? tripSpan?.start ?? new Date().toISOString().slice(0, 10)),
  );
  const complete = isCompleteRange(value) ? value : null;
  const state = complete ? rangePickState(complete, tripSpan) : null;
  return (
    <View style={styles.cal}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous month">
          <Text style={{ color: C.inkFaded, fontSize: 14 }}>‹</Text>
        </Pressable>
        <Text style={{ color: C.ink, fontSize: 14, fontWeight: "700" }}>{monthTitle(month)}</Text>
        <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next month">
          <Text style={{ color: C.inkFaded, fontSize: 14 }}>›</Text>
        </Pressable>
        {tripSpan && (
          <Text style={[styles.calMeta, { marginLeft: "auto" }]}>trip · {spanLabel(tripSpan)}</Text>
        )}
      </View>
      <View style={styles.calRow}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <Text key={i} style={[styles.calMeta, styles.calCell, { height: 16 }]}>
            {d}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week, w) => (
        <View key={w} style={styles.calRow}>
          {week.map((day, i) => {
            if (day === null) return <View key={i} style={styles.calCell} />;
            const c = dayCellState(day, value, tripSpan);
            const bg = c.edge
              ? c.outside
                ? C.warningSoft
                : C.green
              : c.picked
                ? c.outside
                  ? C.warningSoft
                  : C.greenSoft
                : c.inTrip
                  ? C.navySoft
                  : "transparent";
            const ink = c.edge && !c.outside ? C.navy : c.outside ? C.warning : c.picked ? C.greenInk : c.inTrip ? C.ink : C.inkFaded;
            return (
              <Pressable
                key={day}
                onPress={() => onChange(pickDay(value, day))}
                accessibilityRole="button"
                accessibilityLabel={day}
                accessibilityState={{ selected: c.picked }}
                style={[
                  styles.calCell,
                  { backgroundColor: bg },
                  c.edge && { borderRadius: R.pill },
                  c.edge && c.outside && { borderWidth: 2, borderColor: C.warning },
                ]}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: ink, fontWeight: c.edge ? "800" : c.inTrip ? "600" : "400" }}>
                  {Number(day.slice(8, 10))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {complete && state ? (
          <>
            <Text style={{ fontFamily: F.mono, fontSize: 13, fontWeight: "700", color: C.ink }}>{rangeLabel(complete)}</Text>
            <Text style={styles.calMeta}>{nightsLabel(state.nights)}</Text>
            {state.outsideDays > 0 ? (
              <Text style={[styles.calMeta, { color: C.warning }]}>
                ⚠ {state.outsideDays} day{state.outsideDays === 1 ? "" : "s"} outside the trip
              </Text>
            ) : state.wholeTrip ? (
              <Text style={[styles.calMeta, { color: C.greenInk }]}>✓ whole trip</Text>
            ) : null}
            {state.extendTo && onExtendTrip ? (
              <Chip warn onPress={() => onExtendTrip(state.extendTo!)}>
                Extend trip to {spanLabel(state.extendTo)}
              </Chip>
            ) : tripSpan && !state.wholeTrip ? (
              <Chip onPress={() => onChange({ start: tripSpan.start, end: tripSpan.end })}>Whole trip</Chip>
            ) : null}
          </>
        ) : (
          <Text style={styles.calMeta}>{value.start ? "Pick the last day" : "Pick the first day"}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cal: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    borderRadius: R.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  calRow: { flexDirection: "row" },
  calCell: { flex: 1, height: 32, alignItems: "center", justifyContent: "center", textAlign: "center" },
  calMeta: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
  kicker: {
    fontFamily: F.mono,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.card,
    padding: 14,
  },
  pill: {
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: { fontFamily: F.mono, fontSize: 10, fontWeight: "600", letterSpacing: 0.6 },
  estimate: {
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  estimateText: { fontFamily: F.mono, fontSize: 9, letterSpacing: 0.8, color: C.inkFaded },
  button: {
    borderRadius: R.md,
    paddingHorizontal: 14,
    minHeight: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: { fontSize: 13, fontWeight: "700" },
  segmented: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 2,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.pill,
    padding: 3,
  },
  segment: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: R.pill },
  segmentMono: { paddingHorizontal: 10, paddingVertical: 5 },
  segmentOn: {
    backgroundColor: C.surface,
    // shadow-rv-sm: 0 1px 2px rgba(0,0,0,.28) (packages/ui/styles/entry.css)
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: 13, fontWeight: "700" },
  segmentTextMono: { fontFamily: F.mono, fontSize: 11 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { fontFamily: F.mono, fontSize: 10, fontWeight: "600" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: R.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toastGlyph: { fontSize: 14, fontWeight: "700" },
  toastTitle: { fontSize: 12.5, fontWeight: "600" },
  toastSub: { fontFamily: F.mono, fontSize: 10, fontWeight: "500", color: C.inkMuted },
  toastUndo: { fontSize: 11, textDecorationLine: "underline" },
});
