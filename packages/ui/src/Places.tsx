import type { ReactNode } from "react";
import { MapPin, UserRound, Plus, RotateCcw, Map as MapIcon, type LucideIcon } from "lucide-react";
import type { ReservationType, SavedPlace, SavedPlacePatch } from "@rv-trip/core";
import { categoryMeta } from "./category";
import { CategoryTile } from "./CategoryTile";
import { Stars } from "./Stars";
import { ResearchPad } from "./ResearchPad";

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
 *
 * Since #82 the card also EXPANDS in place (Q2 → B): pressing the name opens
 * the research pad, which PROMOTES the two fields the card already renders
 * read-only — `note` and `rating` — into live ones, on BOTH shelves, and hangs
 * the doors out and Google's own line under them. A place you are still
 * deciding about is exactly the one worth a note and a star.
 *
 * Nothing is duplicated by that: while the pad is open, the footer's left slot
 * (the source line on "want", the stars + trip on "been") is EMPTY, because the
 * pad is carrying both — two star rows on one card is the very thing the pad
 * exists to prevent.
 */
export function PlaceCard({
  savedPlace,
  expanded = false,
  drill,
  gline,
  byline,
  onToggleExpand,
  onPatch,
  onAddToTrip,
  onRevisit,
}: {
  savedPlace: SavedPlace;
  /** The research pad, open in place (#82). */
  expanded?: boolean;
  /** the doors out, inside the pad. Locality is `savedPlace.region`. */
  drill?: ReactNode;
  /** the quiet Google line, last in the pad. App-filled — a DS component never
   * fetches. */
  gline?: ReactNode;
  /** The change byline (#78), on its own line in the pad. App-filled: the line
   * opens a popover that fetches, and no DS component does either. */
  byline?: ReactNode;
  /** Absent → the card has no expand affordance at all and renders exactly as
   * it shipped. Present → the name is the expand, and pressing it again closes
   * the pad. The open card's id is the library's state, not the card's. */
  onToggleExpand?: () => void;
  /** The pad's ONE write, optional exactly like the two buttons below it:
   * absent, the pad's fields render read-only, which is today's behaviour. */
  onPatch?: (patch: SavedPlacePatch) => void;
  onAddToTrip?: () => void;
  onRevisit?: () => void;
}) {
  const p = savedPlace;
  const want = p.status === "want";
  /** "Heard from Dana" on the queue, the trip it was visited on in the archive —
   * whichever the footer would have shown, shown beside the stars instead. */
  const meta = want ? (
    p.source ? (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-rv-ink-faded">
        <UserRound className="size-3 text-rv-ink-subtle" />
        Heard from {p.source}
      </span>
    ) : null
  ) : p.tripName ? (
    <span className="truncate font-mono text-[11px] text-rv-ink-faded">· {p.tripName}</span>
  ) : null;
  return (
    <div className="flex flex-col gap-[11px] rounded-rv-card border border-rv-border bg-rv-surface px-[18px] py-4 shadow-rv-sm transition-[transform,box-shadow] duration-[120ms] hover:-translate-y-0.5 hover:shadow-rv-lg">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <CategoryTile type={p.type} size="md" />
          <div className="min-w-0">
            <h3 className="m-0 mb-0.5 truncate text-[16px] font-extrabold tracking-[-0.01em] text-rv-ink">
              {onToggleExpand ? (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  aria-expanded={expanded}
                  className="m-0 max-w-full cursor-pointer truncate border-none bg-transparent p-0 text-left text-[16px] font-extrabold tracking-[-0.01em] text-rv-ink"
                >
                  {p.place.name}
                </button>
              ) : (
                p.place.name
              )}
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

      {expanded ? (
        <ResearchPad
          note={p.note ?? ""}
          placeholder="Jot or paste what you find…"
          rating={p.rating ?? 0}
          expanded
          drill={drill}
          gline={gline}
          meta={meta}
          byline={byline}
          // Uncontrolled: nothing above this card holds a note draft, and a
          // commit-on-blur field does not need one. `onPatch` is the whole
          // write — one prop, the way `onAddToTrip`/`onRevisit` are one each.
          onNoteCommit={
            onPatch
              ? (v) => {
                  const next = v.trim() === "" ? null : v;
                  if (next !== (p.note ?? null)) onPatch({ note: next });
                }
              : undefined
          }
          onRating={onPatch ? (n) => onPatch({ rating: n === 0 ? null : n }) : undefined}
        />
      ) : (
        p.note && <p className="m-0 text-[13.5px] leading-relaxed text-rv-ink-muted">{p.note}</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-rv-border pt-1.5">
        {/* The pad has both of these while it is open; the footer keeps only its
            action, which is untouched. */}
        {expanded ? (
          <span />
        ) : want ? (
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
            className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-accent-deep px-3 py-1.5 text-[13px] font-bold text-rv-accent-ink"
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
  /** Optional: a segment whose vocabulary has no honest glyph renders its label
   * alone. Settings' Units row (Imperial / Metric) is the case — every existing
   * caller still passes one, so no shipped pill changes. */
  Icon?: LucideIcon;
  count?: number;
}

/** Pill segmented control — the primary shelf switch. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  mono = false,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  /** The compact mono variant: mono type one step down, tighter padding, and
   * the active icon takes the button's own ink instead of green. For a pill
   * that sits *over* a surface rather than in a control row — the map's style
   * switch. Type only; the labels are content and stay as written. */
  mono?: boolean;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-rv-pill border border-rv-border bg-rv-surface-alt p-[3px]">
      {options.map((o) => {
        const on = o.value === value;
        const activeIcon = mono ? "text-rv-ink" : "text-rv-green";
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border-none font-bold ${
              mono ? "px-2.5 py-[5px] font-mono text-[11px]" : "px-3.5 py-1.5 text-[13px]"
            } ${on ? "bg-rv-surface text-rv-ink shadow-rv-sm" : "bg-transparent text-rv-ink-faded"}`}
          >
            {o.Icon && <o.Icon className={`size-3.5 ${on ? activeIcon : "text-rv-ink-subtle"}`} />}
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
  fill = false,
}: {
  value: T;
  options: { value: T; Icon: LucideIcon; label: string }[];
  onChange: (v: T) => void;
  /** Below `md`, stretch to the full row and show each option's label beside
   * its icon — two 34px icons stranded at the end of a phone row are not a
   * tab pair. At `md` and up this is the icon-only pill it has always been.
   * Composition, not a restyle from the call site. */
  fill?: boolean;
}) {
  return (
    <div
      className={`gap-0.5 rounded-rv-md border border-rv-border bg-rv-surface-alt p-[3px] ${
        fill ? "flex w-full md:inline-flex md:w-auto" : "inline-flex"
      }`}
    >
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
              fill ? "flex-1 gap-1.5 md:flex-none" : ""
            } ${on ? "bg-rv-surface shadow-rv-sm" : "bg-transparent"}`}
          >
            <o.Icon className={`size-4 ${on ? "text-rv-green" : "text-rv-ink-subtle"}`} />
            {fill && (
              <span
                className={`text-[13px] font-bold md:hidden ${on ? "text-rv-ink" : "text-rv-ink-faded"}`}
              >
                {o.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A filter chip with a count — active fills navy.
 *
 * `tone="warn"` is the third look (#80): the amber "No place yet" chip. It is
 * not another slice of the same pile — it is the pile that cannot be drawn on
 * the map — so the INACTIVE state carries the documented attention colour
 * rather than the neutral hairline. Active still fills navy: pressed is
 * pressed, whatever the chip is about.
 */
export function FilterChip({
  label,
  count,
  active,
  type,
  tone = "default",
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** When set, the chip carries that category's icon in its color. */
  type?: ReservationType;
  tone?: "default" | "warn";
  onClick: () => void;
}) {
  const cm = type ? categoryMeta(type) : null;
  const idle =
    tone === "warn"
      ? "border-rv-warning bg-rv-warning-soft text-rv-warning"
      : "border-rv-border bg-rv-surface text-rv-ink-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border px-[13px] py-1.5 text-[13px] font-semibold ${
        active ? "border-transparent bg-rv-navy text-white" : idle
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
