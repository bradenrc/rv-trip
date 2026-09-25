import { Star, Tent, Lightbulb, Plane, Ship } from "lucide-react";
import type { TravelMode } from "@rv-trip/core";

/**
 * The month-at-a-glance gantt primitives. Each is a self-contained, labeled row
 * (or a positioned cell) that composes into the timeline. Grid columns are
 * derived from the data length so a trip of any duration lays out correctly.
 */

/** The leg column. It is `sticky left-0` inside the timeline's own
 * `overflow-x-auto`, so the month scrolls and the label you are reading stays
 * put. The opaque `bg-rv-surface` (the gantt card's own surface) is
 * load-bearing — without it the bars slide visibly beneath the labels — and so
 * is `self-stretch`: the rows align `center`/`end`, which would otherwise size
 * this to its ~30px of text and leave an unpainted band above and below it in
 * a 78px lane. For the same reason the rows carry no `gap` between the gutter
 * and the lane: a gap cannot be painted, and bars would scroll through it. */
const gutter =
  "sticky left-0 z-10 flex w-[92px] flex-none flex-col justify-center self-stretch " +
  "border-r border-rv-border-soft bg-rv-surface pr-2 md:w-[120px]";
const kicker = "mb-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-rv-ink-faded";

function cols(n: number) {
  return `repeat(${n}, minmax(0, 1fr))`;
}

/**
 * The mode glyph a fly/ferry day or arrival carries (#110 §2). A drive — the
 * common case — draws none: plain navy already means "moving by road".
 */
function ModeGlyph({ mode, className }: { mode: TravelMode | null | undefined; className: string }) {
  if (mode === "fly") return <Plane aria-hidden className={className} />;
  if (mode === "ferry") return <Ship aria-hidden className={className} />;
  return null;
}

/**
 * The one-line colored day-kind bar — the whole trip's rhythm at a glance.
 *
 * `mode` is optional and additive (#110 §2): a fly/ferry cell centres a 12px
 * Plane/Ship. The cell becomes a `dark` chrome island (the TripPlanner lens
 * toggle precedent) so `text-rv-ink-muted` reads slate-300 on navy in BOTH
 * halves — light ink-muted is slate-600 and would vanish on navy.
 */
export function RhythmStrip({
  cells,
}: {
  cells: { color: string; title: string; mode?: TravelMode }[];
}) {
  return (
    <div className="mb-1.5 flex items-center">
      <div className={`${gutter} font-mono text-[12px] uppercase tracking-[0.1em] text-rv-ink-faded`}>
        Rhythm
      </div>
      <div
        className="grid h-[26px] flex-1 overflow-hidden rounded-rv-sm border border-rv-border"
        style={{ gridTemplateColumns: cols(cells.length) }}
      >
        {cells.map((c, i) =>
          c.mode === "fly" || c.mode === "ferry" ? (
            <div
              key={i}
              title={c.title}
              data-mode={c.mode}
              className="dark flex items-center justify-center text-rv-ink-muted"
              style={{ background: c.color }}
            >
              <ModeGlyph mode={c.mode} className="size-3 flex-none" />
            </div>
          ) : (
            <div key={i} title={c.title} style={{ background: c.color }} />
          ),
        )}
      </div>
    </div>
  );
}

/** Day-number ruler; week starts (and the first day) are bolder with a divider. */
export function Ruler({ cells }: { cells: { letter: string; label: string; weekStart: boolean }[] }) {
  return (
    <div className="mb-2.5 flex items-end">
      <div className={gutter} />
      <div className="grid flex-1" style={{ gridTemplateColumns: cols(cells.length) }}>
        {cells.map((t, i) => (
          <div
            key={i}
            className="flex flex-col items-start pl-0.5 pt-[3px]"
            style={{ borderLeft: t.weekStart ? "1px solid var(--color-rv-border)" : "none" }}
          >
            <span className="font-mono text-[9px] text-rv-ink-faded">{t.letter}</span>
            <span
              className="font-mono"
              style={{
                fontSize: t.weekStart || i === 0 ? "12px" : "9px",
                fontWeight: t.weekStart || i === 0 ? 700 : 500,
                color: t.weekStart || i === 0 ? "var(--color-rv-ink)" : "var(--color-rv-ink-faded)",
              }}
            >
              {t.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A leg row: its label gutter plus a grid the caller fills with <StopBar>s.
 * `rowHeight` drives the timeline's density (Comfortable 112 / Compact 78 / Dense 58). */
export function SwimLane({
  kicker: k,
  name,
  columns,
  rowHeight = 112,
  children,
}: {
  kicker: string;
  name: string;
  columns: number;
  rowHeight?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center">
      <div className={gutter}>
        <div className={kicker}>{k}</div>
        <div className="text-[13px] font-bold leading-tight text-rv-ink">{name}</div>
      </div>
      <div
        className="grid flex-1 rounded-rv-sm"
        style={{
          gridTemplateColumns: cols(columns),
          gridAutoRows: `${rowHeight}px`,
          backgroundImage: "linear-gradient(90deg, var(--color-rv-border-soft) 1px, transparent 1px)",
          backgroundSize: "calc(100% / 4) 100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A scheduled stop as a gantt bar, positioned by grid-column. Navy left edge
 * = the arrival day. Meta chips show rating, reservation and idea counts.
 *
 * `arriveMode` (#110 §2) is optional: `undefined` keeps the navy edge every
 * shipped caller draws; `null` means nothing arrived (no inbound segment), so
 * no edge; `fly`/`ferry` keep the edge and put a 10px Plane/Ship before the
 * range, in the range's own `text-rv-green`.
 *
 * It is ALSO a drop target (#80): a do/eat idea dragged off the shelf lands on
 * a stop rather than on open days — an open span is not a stop, so there is
 * nothing there for it to attach to. `active` is the same highlight contract
 * `OpenSpan` already holds: the caller lights only the targets the thing in
 * hand can actually land on, so the wrong target simply never invites the drop.
 */
export function StopBar({
  name,
  range,
  rating,
  resCount,
  ideaCount,
  startCol,
  span,
  arriveMode,
  compact = false,
  active = false,
  onClick,
  onDragOver,
  onDrop,
}: {
  name: string;
  range: string;
  rating: number;
  resCount: number;
  ideaCount: number;
  startCol: number;
  span: number;
  /** How the stop was arrived at; `null` = nothing arrived (no edge). */
  arriveMode?: TravelMode | null;
  /** tighter padding/gap for the Compact & Dense timeline densities */
  compact?: boolean;
  /** Lit because the thing being dragged can land here. */
  active?: boolean;
  onClick?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) {
  const showMeta = rating > 0 || resCount > 0 || ideaCount > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative m-[4px_3px] flex cursor-pointer flex-col overflow-hidden rounded-rv-md border bg-rv-green-soft text-left shadow-rv-sm transition hover:-translate-y-px hover:shadow-rv-lg ${
        active ? "border-dashed border-rv-accent shadow-rv-lg" : "border-rv-green"
      } ${compact ? "gap-[2px] p-[6px_8px_6px_12px]" : "gap-[3px] p-[8px_9px_8px_13px]"}`}
      style={{ gridColumn: `${startCol} / span ${span}`, gridRow: 1 }}
    >
      {arriveMode !== null && (
        <span className="absolute inset-y-0 left-0 w-1 rounded-l-rv-sm bg-rv-navy" />
      )}
      <span className="text-[13px] font-bold leading-tight text-rv-green-ink text-pretty">{name}</span>
      <span className="inline-flex items-center gap-1 font-mono text-[9px] text-rv-green">
        <ModeGlyph mode={arriveMode} className="size-2.5 flex-none" />
        {range}
      </span>
      {showMeta && (
        <div className="mt-auto flex flex-wrap items-center gap-[5px]">
          {rating > 0 && (
            <span className="inline-flex items-center gap-[3px] font-mono text-[9px] text-rv-accent">
              <Star className="size-2.5 fill-current" />
              {rating.toFixed(1)}
            </span>
          )}
          {resCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-rv-pill border border-rv-green bg-rv-surface px-[7px] py-0.5 font-mono text-[9px] text-rv-green-ink">
              <Tent className="size-2.5" />
              {resCount}
            </span>
          )}
          {ideaCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-rv-pill border border-rv-border-hi bg-rv-surface px-[7px] py-0.5 font-mono text-[9px] text-rv-ink">
              <Lightbulb className="size-2.5" />
              {ideaCount}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

/** A run of unplanned days in the timeline; a drop target while a floating stop
 * is being dragged. */
export function OpenSpan({
  count,
  startCol,
  span,
  active,
  onDragOver,
  onDrop,
}: {
  count: number;
  startCol: number;
  span: number;
  active: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="m-[4px_3px] flex flex-col justify-center gap-0.5 rounded-rv-md px-2.5"
      style={{
        gridColumn: `${startCol} / span ${span}`,
        gridRow: 1,
        background: active ? "var(--color-rv-green-soft)" : "var(--color-rv-navy-soft)",
        border: `1px dashed ${active ? "var(--color-rv-green)" : "var(--color-rv-border-hi)"}`,
      }}
    >
      <span className="font-mono text-[12px] font-semibold text-rv-ink-faded">{count} open</span>
      {active && <span className="font-mono text-[9px] text-rv-green">drop here</span>}
    </div>
  );
}

/** The unplanned-days lane wrapper (label gutter + grid). */
export function OpenLane({ columns, children }: { columns: number; children: React.ReactNode }) {
  return (
    <div className="mt-0.5 flex items-center">
      <div className={gutter}>
        <div className={kicker}>Unplanned</div>
        <div className="text-[13px] font-bold text-rv-ink-faded">Open days</div>
      </div>
      <div className="grid flex-1" style={{ gridTemplateColumns: cols(columns), gridAutoRows: "52px" }}>
        {children}
      </div>
    </div>
  );
}

/** A navy day swatch holding its mode glyph — the rhythm cell, in miniature. */
function ModeSwatch({ mode }: { mode: TravelMode }) {
  return (
    <span className="dark inline-flex h-3 w-4 items-center justify-center rounded-[2px] bg-rv-navy text-rv-ink-muted">
      <ModeGlyph mode={mode} className="size-2.5" />
    </span>
  );
}

/** The drive/fly/ferry/stay/open + navy-edge key. Static: every trip shows all
 * six keys (#110 §2). */
export function GanttLegend() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-[18px] border-t border-rv-border-soft pt-4 text-[12px] text-rv-ink-faded">
      <Item swatch={<span className="h-3 w-4 rounded-[2px] bg-rv-navy" />}>Drive day</Item>
      <Item swatch={<ModeSwatch mode="fly" />}>Fly day</Item>
      <Item swatch={<ModeSwatch mode="ferry" />}>Ferry day</Item>
      <Item swatch={<span className="h-3 w-4 rounded-[2px] bg-rv-green" />}>Stay day</Item>
      <Item
        swatch={<span className="h-3 w-4 rounded-[2px] border border-dashed border-rv-border-hi bg-rv-navy-soft" />}
      >
        Open — needs a plan
      </Item>
      <Item swatch={<span className="h-3.5 w-1 rounded-[2px] bg-rv-navy" />}>
        Navy edge = arrival
      </Item>
    </div>
  );
}

function Item({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      {swatch}
      {children}
    </span>
  );
}
