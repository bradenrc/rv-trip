"use client";

import {
  BedDouble,
  Car,
  Caravan,
  House,
  Plane,
  Shuffle,
  Tent,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  LODGING_CHOICE_LABEL,
  RIG_CHOICES,
  TRIP_MODE_CHOICES,
  lodgingChoices,
  type LodgingKind,
  type TripModeChoice,
} from "@rv-trip/core";

/**
 * The setup's three questions as choice cards (#103 · Q1 A) — the one-page
 * /trips/new and the same three blocks in Trip settings (klunk row 7).
 *
 * A LOCAL card, not a DS component (the wireframe's own ruling): it composes
 * rv-* tokens only, and "chosen" is rv-green / rv-green-soft — the documented
 * role for a chosen card or segment. Copy lives in core (`TRIP_MODE_CHOICES`,
 * `LODGING_CHOICE_LABEL`, `RIG_CHOICES`) so the phone speaks the same words.
 */

const MODE_ICON: Record<TripModeChoice, LucideIcon> = { road: Car, air: Plane, mixed: Shuffle };
const LODGING_ICON: Record<LodgingKind, LucideIcon> = {
  campground: Tent,
  hotel: BedDouble,
  airbnb: House,
  friends: Users,
};

export function ChoiceCard({
  Icon,
  title,
  sub,
  on,
  small = false,
  onPick,
}: {
  Icon: LucideIcon;
  title: string;
  sub?: string;
  on: boolean;
  small?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      className={`flex cursor-pointer flex-col gap-[3px] rounded-rv-card border-[1.5px] text-left text-rv-ink ${
        small ? "px-2.5 py-2" : "px-3 py-[11px]"
      } ${on ? "border-rv-green bg-rv-green-soft" : "border-rv-border-hi bg-rv-surface"}`}
    >
      <span
        className={`flex items-center gap-[7px] font-extrabold ${small ? "text-[13px]" : "text-[14px]"}`}
      >
        <Icon className={`size-4 flex-none ${on ? "text-rv-green" : ""}`} />
        {title}
      </span>
      {sub && <span className="text-[12px] font-normal text-rv-ink-muted">{sub}</span>}
    </button>
  );
}

/** The mono question line: "1  How does this trip mostly move?" */
export function QuestionLabel({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-rv-ink-faded">
      {n !== undefined && <span className="text-rv-green-ink">{n}</span>}
      {children}
    </div>
  );
}

const GRID = "grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]";
const GRID_FOUR = "grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(108px,1fr))]";

/** Question 1. `withSubs` is the setup page; Trip settings uses the small cards. */
export function TripModeCards({
  value,
  onChange,
  withSubs = true,
}: {
  value: TripModeChoice | null;
  onChange: (m: TripModeChoice) => void;
  withSubs?: boolean;
}) {
  return (
    <div className={GRID}>
      {TRIP_MODE_CHOICES.map((c) => (
        <ChoiceCard
          key={c.value}
          Icon={MODE_ICON[c.value]}
          title={c.label}
          sub={withSubs ? c.sub : undefined}
          small={!withSubs}
          on={value === c.value}
          onPick={() => onChange(c.value)}
        />
      ))}
    </div>
  );
}

/** Question 2, ordered by mode (campgrounds lead a road trip). */
export function LodgingCards({
  mode,
  value,
  onChange,
}: {
  mode: TripModeChoice | null;
  value: LodgingKind | null;
  onChange: (k: LodgingKind) => void;
}) {
  return (
    <div className={GRID_FOUR}>
      {lodgingChoices(mode).map((k) => (
        <ChoiceCard
          key={k}
          Icon={LODGING_ICON[k]}
          title={LODGING_CHOICE_LABEL[k]}
          small
          on={value === k}
          onPick={() => onChange(k)}
        />
      ))}
    </div>
  );
}

/** Question 3 — a road trip only. */
export function RigCards({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={GRID}>
      {RIG_CHOICES.map((c) => (
        <ChoiceCard
          key={String(c.value)}
          Icon={c.value ? Caravan : Car}
          title={c.label}
          sub={c.sub}
          small
          on={value === c.value}
          onPick={() => onChange(c.value)}
        />
      ))}
    </div>
  );
}
