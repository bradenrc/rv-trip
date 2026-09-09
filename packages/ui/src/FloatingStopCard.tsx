import { GripVertical, Lightbulb, CircleCheck } from "lucide-react";
import { FloatingTag } from "./FloatingTag";

/**
 * A dateless "floating" stop in the timeline's side rail. Draggable onto an open
 * span to schedule it. Shows its name, an optional italic note, and its first idea.
 */
export function FloatingStopCard({
  name,
  note,
  firstIdea,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  name: string;
  note?: string | null;
  firstIdea?: string | null;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="mb-3 cursor-grab rounded-rv-card border border-rv-border border-l-4 border-l-rv-warning bg-rv-surface p-4 shadow-rv-sm"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-px size-5 text-rv-ink-subtle" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[17px] font-bold text-rv-ink">{name}</span>
            <FloatingTag />
          </div>
          {note && <p className="m-0 mt-1.5 text-[13px] italic text-rv-ink-muted">“{note}”</p>}
          {firstIdea && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-rv-pill bg-rv-navy-soft px-2.5 py-[3px] font-mono text-[9px] text-rv-ink">
                <Lightbulb className="size-2.5" />
                {firstIdea}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown in place of the rail when every stop has dates. */
export function AllScheduledCard() {
  return (
    <div className="rounded-rv-card border border-rv-green bg-rv-green-soft p-4">
      <div className="flex items-center gap-2.5">
        <CircleCheck className="size-[22px] text-rv-accent" />
        <div>
          <div className="text-[15px] font-bold text-rv-green-ink">Everything scheduled</div>
          <p className="m-0 mt-0.5 text-[13px] text-rv-green-ink/85">
            On the timeline now — every stop has dates.
          </p>
        </div>
      </div>
    </div>
  );
}
