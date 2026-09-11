import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { ReservationType } from "@rv-trip/core";
import { categoryOf } from "@rv-trip/core";
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

export function Centered({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>{children}</View>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: C.inkMuted, fontSize: 14, textAlign: "center", lineHeight: 20 }}>{children}</Text>;
}

const styles = StyleSheet.create({
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
});
