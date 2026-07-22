"use client";

import { useState } from "react";
import { Pointer } from "lucide-react";
import {
  RhythmStrip,
  Ruler,
  SwimLane,
  StopBar,
  OpenSpan,
  OpenLane,
  GanttLegend,
  FloatingStopCard,
  AllScheduledCard,
} from "@rv-trip/ui";
import type { TimelineModel } from "@/lib/trip-logic";

/** Locked to Compact per the app-framework v2 handoff — the exploratory
 * Comfortable/Compact/Dense control was retired. One density, one rhythm. */
const ROW_HEIGHT = 78;

export function Timeline({
  model,
  onOpenStop,
  onSchedule,
}: {
  model: TimelineModel;
  onOpenStop: (id: string) => void;
  onSchedule: (stopId: string) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const dragging = draggedId !== null;
  const days = model.rhythm.length;
  const minWidth = Math.max(820, days * 30);

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
                      onClick={() => onOpenStop(b.stopId)}
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
                    active={dragging}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggedId) onSchedule(draggedId);
                      setDraggedId(null);
                    }}
                  />
                ))}
              </OpenLane>
            </div>
          </div>
          <GanttLegend />
        </div>
      </div>

      {/* Floating rail */}
      <aside className="min-w-[250px] flex-[0_1_290px]">
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
                onDragStart={() => setDraggedId(f.id)}
                onDragEnd={() => setDraggedId(null)}
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
