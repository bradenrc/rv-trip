"use client";

import { useState } from "react";
import { GripVertical, Lightbulb, Tent, Star, Pointer, CircleCheck } from "lucide-react";
import { FloatingTag } from "@rv-trip/ui";
import type { TimelineModel } from "@/lib/trip-logic";

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
  const cols = `repeat(${days}, minmax(0, 1fr))`;
  const minWidth = Math.max(820, days * 30);

  return (
    <div className="flex flex-wrap items-start gap-6">
      {/* Gantt card */}
      <div className="min-w-0 flex-[1_1_660px] rounded-rv-card border border-rv-border bg-rv-surface p-5 shadow-rv-md">
        <div className="overflow-x-auto">
          <div style={{ minWidth }}>
            {/* Rhythm strip */}
            <div className="mb-1.5 flex items-center gap-4">
              <div className="w-[120px] flex-none font-mono text-[12px] uppercase tracking-[0.1em] text-rv-ink-faded">
                Rhythm
              </div>
              <div
                className="grid h-[26px] flex-1 overflow-hidden rounded-rv-sm border border-rv-border"
                style={{ gridTemplateColumns: cols }}
              >
                {model.rhythm.map((r, i) => (
                  <div key={i} title={r.title} style={{ background: r.color }} />
                ))}
              </div>
            </div>

            {/* Ruler */}
            <div className="mb-2.5 flex items-end gap-4">
              <div className="w-[120px] flex-none" />
              <div className="grid flex-1" style={{ gridTemplateColumns: cols }}>
                {model.ruler.map((t, i) => (
                  <div
                    key={i}
                    className="flex flex-col items-start pl-0.5 pt-[3px]"
                    style={{ borderLeft: t.weekStart ? "1px solid var(--color-rv-border)" : "none" }}
                  >
                    <span className="font-mono text-[9px] text-rv-ink-subtle">{t.letter}</span>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: t.weekStart || i === 0 ? "12px" : "9px",
                        fontWeight: t.weekStart || i === 0 ? 700 : 500,
                        color:
                          t.weekStart || i === 0
                            ? "var(--color-rv-navy)"
                            : "var(--color-rv-ink-faded)",
                      }}
                    >
                      {t.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Leg swimlanes */}
            {model.legs.map((leg) => (
              <div key={leg.id} className="mb-2.5 flex items-center gap-4">
                <div className="w-[120px] flex-none">
                  <div className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-rv-ink-subtle">
                    {leg.kicker}
                  </div>
                  <div className="text-[13px] font-bold leading-tight text-rv-navy">{leg.name}</div>
                </div>
                <div
                  className="grid flex-1 rounded-rv-sm"
                  style={{
                    gridTemplateColumns: cols,
                    gridAutoRows: "112px",
                    backgroundImage:
                      "linear-gradient(90deg, var(--color-rv-border-soft) 1px, transparent 1px)",
                    backgroundSize: "calc(100% / 4) 100%",
                  }}
                >
                  {leg.bars.map((b) => (
                    <button
                      key={b.stopId}
                      type="button"
                      onClick={() => onOpenStop(b.stopId)}
                      className="relative m-[4px_3px] flex cursor-pointer flex-col gap-[3px] overflow-hidden rounded-rv-md border border-rv-green bg-rv-green-soft p-[8px_9px_8px_13px] text-left shadow-rv-sm transition hover:-translate-y-px hover:shadow-rv-lg"
                      style={{ gridColumn: `${b.startCol} / span ${b.span}`, gridRow: 1 }}
                    >
                      <span className="absolute inset-y-0 left-0 w-1 rounded-l-rv-sm bg-rv-navy" />
                      <span className="text-[13px] font-bold leading-tight text-rv-green-ink text-pretty">
                        {b.name}
                      </span>
                      <span className="font-mono text-[9px] text-rv-green-cta">{b.range}</span>
                      {b.showMeta && (
                        <div className="mt-auto flex flex-wrap items-center gap-[5px]">
                          {b.rating > 0 && (
                            <span className="inline-flex items-center gap-[3px] font-mono text-[9px] text-rv-warning">
                              <Star className="size-2.5 fill-current" />
                              {b.rating.toFixed(1)}
                            </span>
                          )}
                          {b.resCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-rv-pill border border-rv-green bg-rv-surface px-[7px] py-0.5 font-mono text-[9px] text-rv-green-ink">
                              <Tent className="size-2.5" />
                              {b.resCount}
                            </span>
                          )}
                          {b.ideaCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-rv-pill border border-rv-border-hi bg-rv-surface px-[7px] py-0.5 font-mono text-[9px] text-rv-navy">
                              <Lightbulb className="size-2.5" />
                              {b.ideaCount}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Unplanned lane */}
            <div className="mt-0.5 flex items-center gap-4">
              <div className="w-[120px] flex-none">
                <div className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-rv-ink-subtle">
                  Unplanned
                </div>
                <div className="text-[13px] font-bold text-rv-ink-faded">Open days</div>
              </div>
              <div className="grid flex-1" style={{ gridTemplateColumns: cols, gridAutoRows: "52px" }}>
                {model.gaps.map((g, i) => (
                  <div
                    key={i}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggedId) onSchedule(draggedId);
                      setDraggedId(null);
                    }}
                    className="m-[4px_3px] flex flex-col justify-center gap-0.5 rounded-rv-md px-2.5"
                    style={{
                      gridColumn: `${g.startCol} / span ${g.span}`,
                      gridRow: 1,
                      background: dragging ? "var(--color-rv-green-soft)" : "var(--color-rv-navy-soft)",
                      border: `1px dashed ${dragging ? "var(--color-rv-green)" : "var(--color-rv-border-hi)"}`,
                    }}
                  >
                    <span className="font-mono text-[12px] font-semibold text-rv-ink-faded">
                      {g.span} open
                    </span>
                    {dragging && (
                      <span className="font-mono text-[9px] text-rv-green-cta">drop here</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-5 flex flex-wrap items-center gap-[18px] border-t border-rv-border-soft pt-4 text-[12px] text-rv-ink-faded">
          <LegendItem swatch={<span className="h-3 w-4 rounded-[2px] bg-rv-navy" />}>Drive day</LegendItem>
          <LegendItem swatch={<span className="h-3 w-4 rounded-[2px] bg-rv-green" />}>Stay day</LegendItem>
          <LegendItem
            swatch={<span className="h-3 w-4 rounded-[2px] border border-dashed border-rv-border-hi bg-rv-navy-soft" />}
          >
            Open — needs a plan
          </LegendItem>
          <LegendItem swatch={<span className="h-3.5 w-1 rounded-[2px] bg-rv-navy" />}>
            Navy edge = arrival / drive-in
          </LegendItem>
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
          <div className="rounded-rv-card border border-rv-green bg-rv-green-soft p-4">
            <div className="flex items-center gap-2.5">
              <CircleCheck className="size-[22px] text-rv-green-cta" />
              <div>
                <div className="text-[15px] font-bold text-rv-green-ink">Everything scheduled</div>
                <p className="m-0 mt-0.5 text-[13px] text-rv-green-ink/85">
                  On the timeline now — every stop has dates.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {model.floating.map((f) => (
              <div
                key={f.id}
                draggable
                onClick={() => onOpenStop(f.id)}
                onDragStart={() => setDraggedId(f.id)}
                onDragEnd={() => setDraggedId(null)}
                className="mb-3 cursor-grab rounded-rv-card border border-rv-border border-l-4 border-l-rv-warning bg-rv-surface p-4 shadow-rv-sm"
              >
                <div className="flex items-start gap-2">
                  <GripVertical className="mt-px size-5 text-rv-ink-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[17px] font-bold text-rv-navy">{f.name}</span>
                      <FloatingTag />
                    </div>
                    {f.note && (
                      <p className="m-0 mt-1.5 text-[13px] italic text-rv-ink-muted">“{f.note}”</p>
                    )}
                    {f.firstIdea && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-rv-pill bg-rv-navy-soft px-2.5 py-[3px] font-mono text-[9px] text-rv-navy">
                          <Lightbulb className="size-2.5" />
                          {f.firstIdea}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
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

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      {swatch}
      {children}
    </span>
  );
}
