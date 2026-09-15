"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Library, Pointer } from "lucide-react";
import {
  RhythmStrip,
  Ruler,
  SwimLane,
  StopBar,
  OpenSpan,
  OpenLane,
  GanttLegend,
  FilterChip,
  FloatingStopCard,
  AllScheduledCard,
  ShelfIdeaCard,
  DrillRow,
  ideaCategoryType,
} from "@rv-trip/ui";
import { GoogleLine } from "@/components/places/GoogleLine";
import type { Idea } from "@rv-trip/core";
import type { IdeaShelf, ShelfFilter, TimelineGap, TimelineModel } from "@/lib/trip-logic";

/** Locked to Compact per the app-framework v2 handoff — the exploratory
 * Comfortable/Compact/Dense control was retired. One density, one rhythm. */
const ROW_HEIGHT = 78;

/**
 * What is in hand during a drag. Two payload kinds, one drop layer (#80):
 * a floating STOP (which lands on open days, as it always has) and a shelf
 * IDEA (which lands on open days when it is a stay, and on a stop bar when it
 * is a do or an eat).
 */
export type TimelineDrag =
  | { kind: "stop"; id: string }
  | { kind: "idea"; id: string; category: Idea["category"] };

/** An open span is not a stop, so there is nothing there for a do/eat idea to
 * attach to; a stay-idea and a floating stop both become one. */
function landsOnOpenDays(d: TimelineDrag | null): boolean {
  return d !== null && (d.kind === "stop" || d.category === "stay");
}
/** …and the mirror: only an idea that is NOT a stay attaches to a stop bar.
 * (A floating stop dropped on another stop means nothing.) */
function landsOnAStop(d: TimelineDrag | null): boolean {
  return d !== null && d.kind === "idea" && d.category !== "stay";
}

export function Timeline({
  model,
  shelf,
  shelfFilter,
  onShelfFilter,
  onOpenStop,
  onSchedule,
  onPlanIdea,
  onAttachIdea,
  onAddFromPlaces,
  onCycleIdea,
  onLocateIdea,
  onRateIdea,
  onNoteIdea,
  onCommitIdeaNote,
  ideaPicker,
  ideaActions,
}: {
  model: TimelineModel;
  /** The rail's first section (#80) — the trip's unattached maybes, already
   * grouped and counted by `ideaShelf` in @rv-trip/core. */
  shelf: IdeaShelf;
  shelfFilter: ShelfFilter;
  onShelfFilter: (f: ShelfFilter) => void;
  onOpenStop: (id: string) => void;
  /** `gap` is the open span the card was DROPPED on — the stop takes its first
   * date, not the trip's longest empty run (#40). */
  onSchedule: (stopId: string, gap: TimelineGap | null) => void;
  /** A stay-idea dropped on open days: it becomes a stop with those dates. */
  onPlanIdea: (ideaId: string, gap: TimelineGap) => void;
  /** A do/eat idea dropped on a stop bar: it leaves the shelf and lives there. */
  onAttachIdea: (ideaId: string, stopId: string) => void;
  onAddFromPlaces: () => void;
  /** The shelf card's own pill: idea → planned → done. */
  onCycleIdea: (ideaId: string) => void;
  /** Opens the app's place picker on a coordless shelf row — the same #69
   * entrance the stop sheet's card has. */
  onLocateIdea: (ideaId: string) => void;
  /**
   * The expanded row's research pad (#82). SHELF-SIDE handlers, not the stop
   * sheet's: an unattached idea is not in any stop's `ideas`, so the sheet's
   * `onIdeaRating`/`onIdeaNote` — which all key on `selectedStop.id` — cannot
   * reach this row at all.
   */
  onRateIdea: (ideaId: string, n: number) => void;
  onNoteIdea: (ideaId: string, v: string) => void;
  onCommitIdeaNote: (ideaId: string) => void;
  /** The open picker, mounted under the row the app opened it on. */
  ideaPicker?: (idea: Idea) => ReactNode;
  /** The row menu the app hangs on a shelf card (#74's door lands here). */
  ideaActions?: (idea: Idea) => ReactNode;
}) {
  const [dragged, setDragged] = useState<TimelineDrag | null>(null);
  /**
   * Which shelf row has its research pad open — ONE at a time, and the rail's
   * own state, exactly as `dragged` is. It never leaves this component: the
   * pad's writes go straight out through the handlers above, so there is
   * nothing for TripPlanner to hold.
   */
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(null);

  const openActive = landsOnOpenDays(dragged);
  const stopActive = landsOnAStop(dragged);
  const days = model.rhythm.length;
  const minWidth = Math.max(820, days * 30);

  const drop = (fn: () => void) => () => {
    fn();
    setDragged(null);
  };

  return (
    <div className="flex flex-wrap items-start gap-6">
      {/* Gantt column */}
      <div className="min-w-0 flex-[1_1_660px]">
        <div className="rounded-rv-card border border-rv-border bg-rv-surface p-5 shadow-rv-md">
          <div className="overflow-x-auto">
            <div style={{ minWidth }}>
              <RhythmStrip cells={model.rhythm} />
              <Ruler cells={model.ruler} />
              {model.legs.map((leg) => (
                <SwimLane key={leg.id} kicker={leg.kicker} name={leg.name} columns={days} rowHeight={ROW_HEIGHT}>
                  {leg.bars.map((b) => (
                    <StopBar
                      key={b.stopId}
                      name={b.name}
                      range={b.range}
                      rating={b.rating}
                      resCount={b.resCount}
                      ideaCount={b.ideaCount}
                      startCol={b.startCol}
                      span={b.span}
                      compact
                      active={stopActive}
                      onClick={() => onOpenStop(b.stopId)}
                      onDragOver={(e) => {
                        if (stopActive) e.preventDefault();
                      }}
                      onDrop={drop(() => {
                        if (dragged?.kind === "idea") onAttachIdea(dragged.id, b.stopId);
                      })}
                    />
                  ))}
                </SwimLane>
              ))}
              <OpenLane columns={days}>
                {model.gaps.map((g, i) => (
                  <OpenSpan
                    key={i}
                    count={g.span}
                    startCol={g.startCol}
                    span={g.span}
                    active={openActive}
                    onDragOver={(e) => {
                      if (openActive) e.preventDefault();
                    }}
                    onDrop={drop(() => {
                      if (!dragged) return;
                      if (dragged.kind === "stop") onSchedule(dragged.id, g);
                      else if (dragged.category === "stay") onPlanIdea(dragged.id, g);
                    })}
                  />
                ))}
              </OpenLane>
            </div>
          </div>
          {/* A horizontal scroll nobody notices is a view that looks truncated.
              Phone-only: at md the whole month fits without scrolling. */}
          <div className="mt-2 font-mono text-[10px] text-rv-ink-faded md:hidden">
            ← swipe the calendar · the leg column stays put →
          </div>
          <GanttLegend />
        </div>
      </div>

      {/*
        ONE rail, TWO sections, in a fixed order: the Ideas shelf (#80) and then
        the unchanged "Not yet scheduled" floating stops. The floating half is
        byte-for-byte what it shipped as — the shelf is added above it, never
        instead of it.
      */}
      <aside className="min-w-[290px] flex-[0_1_330px]">
        <div className="mb-4">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <div className="font-mono text-[12px] uppercase tracking-[0.1em] text-rv-ink">
              Ideas
            </div>
            {shelf.countLabel && (
              <span className="font-mono text-[10.5px] text-rv-ink-faded">{shelf.countLabel}</span>
            )}
            <button
              type="button"
              onClick={onAddFromPlaces}
              className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border-hi bg-transparent px-[9px] py-[3px] text-[11.5px] font-semibold text-rv-ink"
            >
              <Library className="size-3.5" />
              Add from Places
            </button>
          </div>

          {shelf.total === 0 ? (
            <div className="rounded-rv-card border border-dashed border-rv-border-hi bg-rv-surface-alt p-4">
              <div className="text-[14px] font-bold text-rv-ink">
                What do you want to do, eat, or stay near?
              </div>
              <p className="m-0 mt-1 text-[13px] text-rv-ink-muted">
                Add a maybe with “+ Add”, or pull one in from your Places.
              </p>
            </div>
          ) : (
            <>
              <p className="m-0 mb-2.5 text-[13px] text-rv-ink-muted">
                Maybes for this trip. Drag a stay onto open days to plan it, or onto a stop to pin
                it there.
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {shelf.chips.map((c) => (
                  <FilterChip
                    key={c.key}
                    label={c.label}
                    count={c.count}
                    active={sameFilter(c.filter, shelfFilter)}
                    tone={c.warn ? "warn" : "default"}
                    onClick={() => onShelfFilter(c.filter)}
                  />
                ))}
              </div>
              {shelf.groups.map((g) => (
                <div key={g.category} className="mb-2">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-rv-ink-faded">
                    {g.label} · {g.ideas.length}
                  </div>
                  {g.ideas.map((row) => (
                    <ShelfIdeaCard
                      key={row.idea.id}
                      idea={row.idea}
                      nearestStopName={row.nearestStopName}
                      distanceMi={row.distanceMi}
                      expanded={expandedIdeaId === row.idea.id}
                      actions={ideaActions?.(row.idea)}
                      picker={ideaPicker?.(row.idea)}
                      /* A shelf idea has no parent stop and so NO LOCALITY:
                         every query is the bare title, and the AI-Mode question
                         drops its " in <locality>" clause. `nearestStopName` is
                         deliberately not used — "nearest stop you already own"
                         is a proximity fact, not this place's town. */
                      drill={
                        <DrillRow
                          name={row.idea.title}
                          type={ideaCategoryType(row.idea.category)}
                        />
                      }
                      gline={<GoogleLine googlePlaceId={row.idea.place?.googlePlaceId} />}
                      onClick={() =>
                        setExpandedIdeaId((id) => (id === row.idea.id ? null : row.idea.id))
                      }
                      onCycle={() => onCycleIdea(row.idea.id)}
                      onLocate={() => onLocateIdea(row.idea.id)}
                      onRating={(n) => onRateIdea(row.idea.id, n)}
                      onNote={(v) => onNoteIdea(row.idea.id, v)}
                      onCommitNote={() => onCommitIdeaNote(row.idea.id)}
                      onDragStart={() =>
                        setDragged({
                          kind: "idea",
                          id: row.idea.id,
                          category: row.idea.category,
                        })
                      }
                      onDragEnd={() => setDragged(null)}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="mb-1 font-mono text-[12px] uppercase tracking-[0.1em] text-rv-warning">
          Not yet scheduled
        </div>
        <p className="m-0 mb-3 text-[13px] text-rv-ink-muted">
          Floating stops — ordered, but dateless. Drag one onto an open span to give it dates.
        </p>

        {model.allScheduled ? (
          <AllScheduledCard />
        ) : (
          <>
            {model.floating.map((f) => (
              <FloatingStopCard
                key={f.id}
                name={f.name}
                note={f.note}
                firstIdea={f.firstIdea}
                onClick={() => onOpenStop(f.id)}
                onDragStart={() => setDragged({ kind: "stop", id: f.id })}
                onDragEnd={() => setDragged(null)}
              />
            ))}
            <div className="mt-3 flex gap-2 text-[13px] text-rv-ink-muted">
              <Pointer className="mt-px size-4 text-rv-green" />
              <span>{model.tailHint}</span>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/** Which chip is pressed. A `near` chip is the same chip only when it names the
 * same stop. */
function sameFilter(a: ShelfFilter, b: ShelfFilter): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "near" || a.stopId === (b as { kind: "near"; stopId: string }).stopId;
}
