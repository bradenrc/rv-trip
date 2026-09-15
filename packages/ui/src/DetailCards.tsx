import type { ReactNode } from "react";
import {
  Check,
  CircleDashed,
  CornerRightUp,
  GripVertical,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  SquarePen,
} from "lucide-react";
import { PICKED_COORDLESS_LABEL, ideaIsLocated } from "@rv-trip/core";
import type { Reservation, Idea } from "@rv-trip/core";
import { categoryMeta, ideaCategoryMeta } from "./category";
import { CategoryTile } from "./CategoryTile";
import { Stars } from "./Stars";
import { StatusPill } from "./StatusPill";
import { money } from "./format";

/** Styled placeholder for a stop's map (real map is a follow-up). */
export function MapPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-[150px] flex-col items-center justify-center gap-1.5 rounded-rv-card border border-rv-border bg-rv-navy-soft text-rv-ink-faded">
      <MapIcon className="size-[30px] text-rv-ink" />
      <span className="font-mono text-[12px]">Map — {label}</span>
    </div>
  );
}

/**
 * A reservation in the stop-detail sheet: category tile, name, cost, a mono meta
 * line (category · type · dates · #conf), an editable rating, and an
 * always-available note.
 *
 * `actions` is a composition slot at the end of the meta line — the row menu
 * (Edit… / Delete) the app hangs there. The DS stays display-only: it renders
 * whatever it is handed and knows nothing about the verbs.
 */
export function ReservationCard({
  reservation,
  dates,
  actions,
  onRating,
  onNote,
  onCommitNote,
}: {
  reservation: Reservation;
  /** preformatted date range (e.g. "Aug 2–5") */
  dates: string | null;
  /** optional row-menu slot, pinned to the end of the meta line */
  actions?: ReactNode;
  onRating: (n: number) => void;
  onNote: (v: string) => void;
  onCommitNote: () => void;
}) {
  const r = reservation;
  const cm = categoryMeta(r.type);
  const lodging = r.type === "campground" || r.type === "lodging";
  return (
    <div className="flex gap-3 rounded-rv-card border border-rv-border bg-rv-surface p-4">
      <CategoryTile type={r.type} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[14px] font-bold text-rv-ink">{r.name}</span>
          <span className="font-mono text-[14px] font-semibold text-rv-accent">
            {r.cost != null ? money(r.cost) : ""}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[12px] text-rv-ink-faded">
          <span className="font-bold uppercase tracking-[0.06em]" style={{ color: cm.color }}>
            {cm.cat}
          </span>
          <span className="uppercase tracking-[0.05em]">{r.type}</span>
          {dates && (
            <>
              <span>·</span>
              <span>{dates}</span>
            </>
          )}
          {r.confirmationNumber && (
            <>
              <span>·</span>
              <span>#{r.confirmationNumber}</span>
            </>
          )}
          <span className="ml-0.5">
            <Stars value={r.rating ?? 0} size={14} onSet={onRating} />
          </span>
          {actions && <span className="ml-auto">{actions}</span>}
        </div>
        <textarea
          value={r.notes ?? ""}
          onChange={(e) => onNote(e.target.value)}
          onBlur={onCommitNote}
          placeholder={
            lodging
              ? "Favorite site #, gate code, avoid the sharp left at the entrance…"
              : "Notes — what to remember, rebook or not…"
          }
          className="mt-2.5 min-h-[44px] w-full resize-y rounded-rv-md border border-rv-border-soft bg-rv-surface-alt px-2.5 py-2 text-[13px] leading-relaxed text-rv-ink-muted"
        />
      </div>
    </div>
  );
}

/**
 * An idea in the stop-detail sheet: category icon, title, a cycling status pill,
 * a "Book" action (promote → reservation) until done, an editable rating once
 * done, and a toggleable note.
 *
 * `actions` is the same composition slot the reservation card carries — the row
 * menu the app hangs at the end of the header line. `picker` is the second one
 * (#69): the app mounts its `PlacePicker` into it and owns the open/closed
 * state, so the kit stays free of app state and of the search wire.
 */
export function IdeaCard({
  idea,
  noteVisible,
  actions,
  picker,
  onCycle,
  onRating,
  onNote,
  onCommitNote,
  onToggleNote,
  onPromote,
  onLocate,
}: {
  idea: Idea;
  noteVisible: boolean;
  /** optional row-menu slot, pinned to the end of the header line */
  actions?: ReactNode;
  /** the open place picker, mounted under the place line (#69) */
  picker?: ReactNode;
  onCycle: () => void;
  onRating: (n: number) => void;
  onNote: (v: string) => void;
  onCommitNote: () => void;
  onToggleNote: () => void;
  /**
   * "Book" — promote to a reservation. OPTIONAL (#80): `reservations.stop_id`
   * is NOT NULL, so an UNATTACHED idea cannot become a reservation at all, and
   * without this handler the action does not render — the same way `onLocate`'s
   * absence already makes the place line read-only.
   */
  onPromote?: () => void;
  /** Opens the app's picker. Without it the place line renders READ-ONLY, and
   * with neither a place nor a handler the card renders nothing new at all. */
  onLocate?: () => void;
}) {
  const cm = ideaCategoryMeta(idea.category);
  const isDone = idea.status === "done";
  return (
    <div className="flex flex-col gap-2 rounded-rv-md border border-rv-border bg-rv-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <cm.Icon className="size-[18px]" style={{ color: cm.color }} />
        <span className="min-w-[120px] flex-1 text-[14px] text-rv-ink">{idea.title}</span>
        {isDone && <Stars value={idea.rating ?? 0} size={14} onSet={onRating} />}
        <StatusPill status={idea.status} onClick={onCycle} />
        {!isDone && onPromote && (
          <button
            type="button"
            onClick={onPromote}
            title="Promote to reservation"
            className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent px-1.5 py-1 text-[13px] font-semibold text-rv-accent"
          >
            <CornerRightUp className="size-4" />
            Book
          </button>
        )}
        <button
          type="button"
          onClick={onToggleNote}
          title="Add a note"
          className="inline-flex size-7 cursor-pointer items-center justify-center border-none bg-transparent p-0"
          style={{ color: noteVisible ? "var(--color-rv-accent)" : "var(--color-rv-ink-subtle)" }}
        >
          <SquarePen className="size-[17px]" />
        </button>
        {actions}
      </div>
      <IdeaPlaceLine idea={idea} onLocate={onLocate} />
      {picker}
      {noteVisible && (
        <textarea
          value={idea.notes ?? ""}
          onChange={(e) => onNote(e.target.value)}
          onBlur={onCommitNote}
          placeholder="Add a note — call ahead, what to remember…"
          className="min-h-[38px] w-full resize-y rounded-rv-md border border-rv-border-soft bg-rv-surface-alt px-2.5 py-[7px] text-[13px] leading-relaxed text-rv-ink-muted"
        />
      )}
    </div>
  );
}

/**
 * The place line under an idea's title (#69). THREE states, because the data
 * has three — `mapIdea` returns a non-null `place` the moment place_name is
 * set, with lat/lng still null, which is the normal outcome of the picker's
 * free-text escape row:
 *
 *   1. no place at all      → "No place yet" + Locate
 *   2. a name, no coords    → the name + why it is not on the map + Locate
 *   3. a name with coords   → the name + "On the map", and nothing to press
 *
 * The coordless copy is the picker's own shipped line (`PICKED_COORDLESS_LABEL`)
 * rather than a fourth wording for the same fact. The line renders nothing at
 * all when the card has neither a place nor a way to set one.
 */
function IdeaPlaceLine({ idea, onLocate }: { idea: Idea; onLocate?: () => void }) {
  if (!idea.place && !onLocate) return null;
  const located = ideaIsLocated(idea);
  return (
    <div className="flex flex-wrap items-center gap-[9px] border-t border-dashed border-rv-border pt-2">
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-rv-ink-faded">
        {idea.place ? (
          <MapPin className="size-3.5 flex-none text-rv-ink-faded" />
        ) : (
          <CircleDashed className="size-3.5 flex-none text-rv-ink-subtle" />
        )}
        {idea.place ? (
          <span className="font-semibold text-rv-ink-muted">{idea.place.name}</span>
        ) : (
          "No place yet"
        )}
      </span>
      {!located && idea.place && (
        <span className="font-mono text-[10.5px] text-rv-ink-faded">
          {PICKED_COORDLESS_LABEL}
        </span>
      )}
      {located ? (
        <span className="ml-auto inline-flex items-center gap-[5px] font-mono text-[10.5px] text-rv-green-ink">
          <Check className="size-3.5" />
          On the map
        </span>
      ) : (
        onLocate && (
          <button
            type="button"
            onClick={onLocate}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border border-rv-green bg-rv-green-soft px-3 py-1 font-mono text-[11px] font-bold text-rv-green"
          >
            <LocateFixed className="size-3.5" />
            Locate
          </button>
        )
      )}
    </div>
  );
}

/**
 * An idea on the trip's SHELF (#80) — the side rail's row, and deliberately NOT
 * `IdeaCard`.
 *
 * The sheet's card is a detail surface: stars, a note pen, a status pill and a
 * Book action. The shelf row is a HANDLE — something you pick up and drop on a
 * day or on a stop — so it carries a grip, the title, where it is relative to
 * the trip, and nothing else. (Book is absent for a harder reason than density:
 * `reservations.stop_id` is NOT NULL, so an unattached idea is not bookable at
 * all.) The two are separate components rather than one with five flags,
 * because they are two different objects that happen to read the same row.
 *
 * `actions` is the same composition slot every other card carries — the app
 * hangs its `RowMenu` there (#74 puts "Clear place" on it).
 */
export function ShelfIdeaCard({
  idea,
  nearestStopName,
  distanceMi,
  actions,
  picker,
  onClick,
  onCycle,
  onLocate,
  onDragStart,
  onDragEnd,
}: {
  idea: Idea;
  /** The nearest stop the trip has actually placed, and how far — the row's
   * second line. There is no city column on an idea, so the anchor named is a
   * stop you already own (`ideaShelf` in @rv-trip/core decides both). */
  nearestStopName?: string | null;
  distanceMi?: number | null;
  actions?: ReactNode;
  /** the open place picker, mounted under the place line */
  picker?: ReactNode;
  /** Absent → the title is plain text. A shelf row is a HANDLE, not a link:
   * there is no detail surface for an unattached idea to open. */
  onClick?: () => void;
  /** Cycles idea → planned → done. Absent → the pill is read-only. */
  onCycle?: () => void;
  /** Opens the app's picker. Absent → the line is read-only. */
  onLocate?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const cm = ideaCategoryMeta(idea.category);
  const located = ideaIsLocated(idea);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="mb-2 flex cursor-grab flex-col gap-1.5 rounded-rv-md border border-rv-border bg-rv-surface px-2.5 py-2 shadow-rv-sm"
    >
      <div className="flex items-center gap-2">
        <GripVertical className="size-4 flex-none text-rv-ink-subtle" aria-hidden />
        <cm.Icon className="size-4 flex-none" style={{ color: cm.color }} />
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-[13.5px] text-rv-ink"
          >
            {idea.title}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-rv-ink">{idea.title}</span>
        )}
        {actions}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        {located ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-rv-ink-faded">
            <MapPin className="size-3 flex-none" />
            {nearestStopName && distanceMi !== null && distanceMi !== undefined
              ? `${nearestStopName} · ${distanceMi} mi`
              : idea.place!.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-rv-ink-faded">
            <CircleDashed className="size-3 flex-none text-rv-ink-subtle" />
            {idea.place ? idea.place.name : "No place yet"}
          </span>
        )}
        {!located && idea.place && (
          <span className="font-mono text-[10px] text-rv-ink-faded">{PICKED_COORDLESS_LABEL}</span>
        )}
        {located ? (
          <span className="ml-auto">
            <StatusPill status={idea.status} onClick={onCycle} />
          </span>
        ) : (
          onLocate && (
            <button
              type="button"
              onClick={onLocate}
              className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-rv-pill border border-rv-green bg-rv-green-soft px-2 py-0.5 font-mono text-[10px] font-bold text-rv-green"
            >
              <LocateFixed className="size-3" />
              Locate
            </button>
          )
        )}
      </div>
      {picker}
    </div>
  );
}
