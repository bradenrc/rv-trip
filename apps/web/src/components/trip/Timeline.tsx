"use client";

import { useEffect, useState } from "react";
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

type Density = "comfortable" | "compact" | "dense";
const ROW_HEIGHT: Record<Density, number> = { comfortable: 112, compact: 78, dense: 58 };
const DENSITY_OPTIONS: [Density, string][] = [
  ["comfortable", "Comfortable"],
  ["compact", "Compact"],
  ["dense", "Dense"],
];

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
  const [density, setDensity] = useState<Density>("compact");
  useEffect(() => {
    const s = localStorage.getItem("rv-timeline-density");
    if (s === "comfortable" || s === "compact" || s === "dense") setDensity(s);
  }, []);
  const changeDensity = (d: Density) => {
    setDensity(d);
    localStorage.setItem("rv-timeline-density", d);
  };

  const dragging = draggedId !== null;
  const days = model.rhythm.length;
  const minWidth = Math.max(820, days * 30);
  const rowHeight = ROW_HEIGHT[density];
  const barCompact = density !== "comfortable";

  return (
    <div className="flex flex-wrap items-start gap-6">
      {/* Gantt column: density control above the card */}
      <div className="min-w-0 flex-[1_1_660px]">
        <div className="mb-3 flex justify-end">
          <div className="inline-flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-rv-ink-faded">Density</span>
            <div className="inline-flex rounded-rv-pill border border-rv-border bg-rv-surface p-[3px]">
              {DENSITY_OPTIONS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => changeDensity(v)}
                  className={`cursor-pointer rounded-rv-pill border-none px-3 py-[5px] text-[12px] font-semibold ${
                    density === v ? "bg-rv-navy text-rv-surface" : "bg-transparent text-rv-ink-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-rv-card border border-rv-border bg-rv-surface p-5 shadow-rv-md">
          <div className="overflow-x-auto">
            <div style={{ minWidth }}>
              <RhythmStrip cells={model.rhythm} />
              <Ruler cells={model.ruler} />
              {model.legs.map((leg) => (
                <SwimLane key={leg.id} kicker={leg.kicker} name={leg.name} columns={days} rowHeight={rowHeight}>
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
                      compact={barCompact}
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
