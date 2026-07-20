import { Map as MapIcon, CornerRightUp, SquarePen } from "lucide-react";
import type { Reservation, Idea } from "@rv-trip/core";
import { categoryMeta } from "./category";
import { CategoryTile } from "./CategoryTile";
import { Stars } from "./Stars";
import { StatusPill } from "./StatusPill";
import { money } from "./format";

/** Styled placeholder for a stop's map (real map is a follow-up). */
export function MapPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-[150px] flex-col items-center justify-center gap-1.5 rounded-rv-card border border-rv-border bg-rv-navy-soft text-rv-ink-faded">
      <MapIcon className="size-[30px] text-rv-navy" />
      <span className="font-mono text-[12px]">Map — {label}</span>
    </div>
  );
}

/**
 * A reservation in the stop-detail sheet: category tile, name, cost, a mono meta
 * line (category · type · dates · #conf), an editable rating, and an
 * always-available note.
 */
export function ReservationCard({
  reservation,
  dates,
  onRating,
  onNote,
  onCommitNote,
}: {
  reservation: Reservation;
  /** preformatted date range (e.g. "Aug 2–5") */
  dates: string | null;
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
          <span className="font-mono text-[14px] font-semibold text-rv-green-cta">
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
 */
export function IdeaCard({
  idea,
  noteVisible,
  onCycle,
  onRating,
  onNote,
  onCommitNote,
  onToggleNote,
  onPromote,
}: {
  idea: Idea;
  noteVisible: boolean;
  onCycle: () => void;
  onRating: (n: number) => void;
  onNote: (v: string) => void;
  onCommitNote: () => void;
  onToggleNote: () => void;
  onPromote: () => void;
}) {
  const cm = categoryMeta("activity");
  const isDone = idea.status === "done";
  return (
    <div className="flex flex-col gap-2 rounded-rv-md border border-rv-border bg-rv-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <cm.Icon className="size-[18px]" style={{ color: cm.color }} />
        <span className="min-w-[120px] flex-1 text-[14px] text-rv-ink">{idea.title}</span>
        {isDone && <Stars value={idea.rating ?? 0} size={14} onSet={onRating} />}
        <StatusPill status={idea.status} onClick={onCycle} />
        {!isDone && (
          <button
            type="button"
            onClick={onPromote}
            title="Promote to reservation"
            className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent px-1.5 py-1 text-[13px] font-semibold text-rv-green-cta"
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
          style={{ color: noteVisible ? "var(--color-rv-green-cta)" : "var(--color-rv-ink-subtle)" }}
        >
          <SquarePen className="size-[17px]" />
        </button>
      </div>
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
