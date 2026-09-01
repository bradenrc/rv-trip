import type { ReactNode } from "react";
import { MapPin, UserRound, Plus, RotateCcw, Map as MapIcon, type LucideIcon } from "lucide-react";
import type { ReservationType, SavedPlace } from "@rv-trip/core";
import { categoryMeta } from "./category";
import { CategoryTile } from "./CategoryTile";
import { Stars } from "./Stars";

/**
 * The Places library — a cross-trip shelf of saved spots. Two shelves off one
 * status field ("want" queue / "been" archive), filtered by the same five
 * categories the planner uses. Everything category-colored resolves through
 * `categoryMeta` so the visual language never forks.
 */

/** Pill naming a place's category, in that category's color. */
export function CategoryChip({ type }: { type: ReservationType }) {
  const cm = categoryMeta(type);
  return (
    <span
      className="inline-flex flex-none items-center gap-[5px] rounded-rv-pill px-2.5 py-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.05em]"
      style={{ background: cm.bg, color: cm.color }}
    >
      <cm.Icon className="size-3" />
      {cm.cat}
    </span>
  );
}

/**
 * A saved place. The footer is what differs by shelf: a "want" place shows who
 * the tip came from and promotes into a trip; a "been" place shows the rating
 * and the trip it was visited on, and offers a revisit.
 */
export function PlaceCard({
  savedPlace,
  onAddToTrip,
  onRevisit,
}: {
  savedPlace: SavedPlace;
  onAddToTrip?: () => void;
  onRevisit?: () => void;
}) {
  const p = savedPlace;
  const want = p.status === "want";
  return (
    <div className="flex flex-col gap-[11px] rounded-rv-card border border-rv-border bg-rv-surface px-[18px] py-4 shadow-rv-sm transition-[transform,box-shadow] duration-[120ms] hover:-translate-y-0.5 hover:shadow-rv-lg">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <CategoryTile type={p.type} size="md" />
          <div className="min-w-0">
            <h3 className="m-0 mb-0.5 truncate text-[16px] font-extrabold tracking-[-0.01em] text-rv-ink">
              {p.place.name}
            </h3>
            {p.region && (
              <div className="inline-flex items-center gap-[5px] font-mono text-[12px] text-rv-ink-faded">
                <MapPin className="size-3 text-rv-green" />
                {p.region}
              </div>
            )}
          </div>
        </div>
        <CategoryChip type={p.type} />
      </div>

      {p.note && <p className="m-0 text-[13.5px] leading-relaxed text-rv-ink-muted">{p.note}</p>}

      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-rv-border pt-1.5">
        {want ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-rv-ink-faded">
            <UserRound className="size-3.5 text-rv-ink-subtle" />
            {p.source ? `Heard from ${p.source}` : "Saved"}
          </span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Stars value={p.rating ?? 0} />
            {p.tripName && (
              <span className="truncate font-mono text-[11.5px] text-rv-ink-faded">
                · {p.tripName}
              </span>
            )}
          </span>
        )}
        {want ? (
          <button
            type="button"
            onClick={onAddToTrip}
            className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-ember px-3 py-1.5 text-[13px] font-bold text-rv-navy"
          >
            <Plus className="size-3.5" fill="currentColor" strokeWidth={2.5} />
            Add to trip
          </button>
        ) : (
          <button
            type="button"
            onClick={onRevisit}
            className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border-hi bg-transparent px-3 py-1.5 text-[13px] font-bold text-rv-ink-muted"
          >
            <RotateCcw className="size-3.5 text-rv-green" />
            Plan a revisit
          </button>
        )}
      </div>
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  Icon: LucideIcon;
  count?: number;
}

/** Pill segmented control — the primary shelf switch. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-rv-pill border border-rv-border bg-rv-surface-alt p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border-none px-3.5 py-1.5 text-[13px] font-bold ${
              on ? "bg-rv-surface text-rv-ink shadow-rv-sm" : "bg-transparent text-rv-ink-faded"
            }`}
          >
            <o.Icon className={`size-3.5 ${on ? "text-rv-green" : "text-rv-ink-subtle"}`} />
            {o.label}
            {o.count != null && <span className="font-mono text-[11px] opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Icon-only toggle group (grid ⇄ map). */
export function ViewSwitch<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; Icon: LucideIcon; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-rv-md border border-rv-border bg-rv-surface-alt p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.label}
            aria-label={o.label}
            aria-pressed={on}
            className={`inline-flex h-[30px] w-[34px] cursor-pointer items-center justify-center rounded-rv-sm border-none ${
              on ? "bg-rv-surface shadow-rv-sm" : "bg-transparent"
            }`}
          >
            <o.Icon className={`size-4 ${on ? "text-rv-green" : "text-rv-ink-subtle"}`} />
          </button>
        );
      })}
    </div>
  );
}

/** A filter chip with a count — active fills navy. */
export function FilterChip({
  label,
  count,
  active,
  type,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** When set, the chip carries that category's icon in its color. */
  type?: ReservationType;
  onClick: () => void;
}) {
  const cm = type ? categoryMeta(type) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border px-[13px] py-1.5 text-[13px] font-semibold ${
        active
          ? "border-transparent bg-rv-navy text-white"
          : "border-rv-border bg-rv-surface text-rv-ink-muted"
      }`}
    >
      {cm && <cm.Icon className="size-3.5" style={active ? undefined : { color: cm.color }} />}
      {label}
      <span className="font-mono text-[11px] opacity-65">{count}</span>
    </button>
  );
}

/** Dashed empty panel for a shelf with nothing on it. */
export function EmptyShelf({
  Icon,
  title,
  blurb,
}: {
  Icon: LucideIcon;
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-rv-card border border-dashed border-rv-border-hi px-6 py-16 text-center">
      <Icon className="size-9 text-rv-green" />
      <div className="text-[16px] font-bold text-rv-ink">{title}</div>
      <p className="m-0 max-w-[42ch] text-[14px] text-rv-ink-muted">{blurb}</p>
    </div>
  );
}

/** Full-height map stand-in for the library's map lens. */
export function PlacesMapPanel({ children }: { children?: ReactNode }) {
  return (
    <div className="relative flex h-full min-h-[420px] items-center justify-center overflow-hidden rounded-rv-card border border-rv-border bg-gradient-to-br from-rv-navy-soft to-rv-surface-alt">
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-rv-border) 1px, transparent 0), linear-gradient(90deg, var(--color-rv-border) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="relative text-center text-rv-ink-faded">
        <MapIcon className="mx-auto size-10 text-rv-green" />
        <div className="mt-2 text-[14px] font-semibold">Map view</div>
        <div className="mt-0.5 font-mono text-[12px]">Pins for every saved place</div>
        {children}
      </div>
    </div>
  );
}
