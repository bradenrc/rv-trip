"use client";

import {
  Pin,
  GripVertical,
  CalendarDays,
  Caravan,
  Plus,
  CirclePlus,
  Calendar,
  CircleAlert,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { FloatingTag, Stars, ReservationLineItem, IdeaLineItem, money } from "@rv-trip/ui";
import type { RouteLeg, RouteSummary } from "@/lib/trip-logic";

export function RouteView({
  legs,
  summary,
  costs,
  onOpenStop,
  routeDrag,
  onRowDragStart,
  onRowDragEnd,
  onRowDrop,
}: {
  legs: RouteLeg[];
  summary: RouteSummary;
  costs: boolean;
  onOpenStop: (id: string) => void;
  routeDrag: { legId: string; stopId: string } | null;
  onRowDragStart: (legId: string, stopId: string) => void;
  onRowDragEnd: () => void;
  onRowDrop: (legId: string, targetId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-8">
      {/* Reading column */}
      <div className="min-w-0 flex-1 basis-[520px] [max-width:760px]">
        <p className="m-0 mb-6 max-w-[60ch] text-[15px] text-rv-ink-muted">
          Lay out the places and take it as you go — dates are optional. Drag to reorder; drives
          between scheduled stops are shown as you plan them.
        </p>

        {legs.map((leg) => (
          <div key={leg.id} id={`route-${leg.id}`} className="mb-8 scroll-mt-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="mb-[3px] font-mono text-[9px] uppercase tracking-[0.12em] text-rv-ink-subtle">
                  {leg.kicker}
                </div>
                <h2 className="m-0 text-[22px] font-extrabold text-rv-navy">{leg.name}</h2>
              </div>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border border-rv-green bg-rv-green-soft px-[13px] py-1.5 text-[13px] font-semibold text-rv-green-cta"
              >
                <Plus className="size-3.5" />
                Add stop
              </button>
            </div>

            {leg.rows.map((row) => (
              <div key={row.stop.id}>
                <div
                  draggable={row.floating}
                  onDragStart={row.floating ? () => onRowDragStart(leg.id, row.stop.id) : undefined}
                  onDragEnd={row.floating ? onRowDragEnd : undefined}
                  onDragOver={row.floating ? (e) => e.preventDefault() : undefined}
                  onDrop={row.floating ? () => onRowDrop(leg.id, row.stop.id) : undefined}
                  className={`flex items-start gap-3 rounded-rv-card border bg-rv-surface p-4 shadow-rv-sm ${
                    routeDrag?.stopId === row.stop.id ? "border-rv-green" : "border-rv-border"
                  }`}
                >
                  {row.floating ? (
                    <GripVertical
                      className="mt-[3px] size-[18px] shrink-0 cursor-grab text-rv-ink-subtle"
                      aria-label="Drag to reorder"
                    />
                  ) : (
                    <Pin className="mt-[3px] size-[18px] shrink-0 text-rv-ink-subtle" aria-label="Ordered by date" />
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenStop(row.stop.id)}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2.5 pl-10">
                      <span className="text-[17px] font-bold text-rv-navy">{row.stop.place.name}</span>
                      {row.floating && <FloatingTag />}
                      {row.dates && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-rv-ink-faded">
                          <CalendarDays className="size-3.5" />
                          {row.dates}
                        </span>
                      )}
                      {row.rating > 0 && <Stars value={row.rating} />}
                    </div>

                    {row.note && (
                      <p className="m-0 max-w-full truncate pl-10 text-[13px] italic text-rv-ink-muted">
                        {row.note}
                      </p>
                    )}

                    {row.reservations.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {row.reservations.map((r) => (
                          <ReservationLineItem
                            key={r.id}
                            type={r.type}
                            name={r.name}
                            cost={costs ? r.cost : null}
                          />
                        ))}
                      </div>
                    )}

                    {row.showIdeaDivider && (
                      <div className="my-0.5 flex items-center gap-2 pl-10">
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-rv-ink-subtle">
                          Ideas
                        </span>
                        <span className="h-px flex-1 bg-rv-border-soft" />
                      </div>
                    )}

                    {row.ideas.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {row.ideas.map((it) => (
                          <IdeaLineItem key={it.id} type={it.type} title={it.title} status={it.status} />
                        ))}
                      </div>
                    )}
                  </button>
                </div>

                {row.driveLabel && (
                  <div className="my-1 ml-8 flex items-center gap-2 py-[5px] font-mono text-[12px] text-rv-ink-faded">
                    <Caravan className="size-4 text-rv-navy" />
                    <span>{row.driveLabel}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-dashed border-rv-border-hi bg-transparent px-[18px] py-2.5 text-[14px] font-semibold text-rv-navy"
        >
          <CirclePlus className="size-4" />
          Add leg
        </button>
      </div>

      <RouteRail summary={summary} costs={costs} />
    </div>
  );
}

function Stat({ Icon, label, value, warn }: { Icon: LucideIcon; label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`mt-px size-[15px] ${warn ? "text-rv-warning" : "text-rv-green"}`} />
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-rv-ink-subtle">{label}</div>
        <div className="text-[13px] font-semibold text-rv-ink-muted">{value}</div>
      </div>
    </div>
  );
}

const kicker = "font-mono text-[11px] uppercase tracking-[0.1em] text-rv-ink-subtle";

function RouteRail({ summary, costs }: { summary: RouteSummary; costs: boolean }) {
  return (
    <aside className="w-[260px] flex-none">
      <div className="sticky top-6 flex flex-col gap-[18px] rounded-rv-card border border-rv-border bg-rv-surface p-[18px] shadow-rv-sm">
        {/* Driving hero */}
        <div>
          <div className={`${kicker} mb-2`}>On the road</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[34px] font-bold leading-none text-rv-navy">
              {summary.driveMiles || "—"}
            </span>
            {summary.driveMiles > 0 && (
              <span className="font-mono text-[15px] font-semibold text-rv-ink-faded">mi</span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-rv-ink-faded">
            {summary.driveMiles > 0 ? `${summary.driveTime} behind the wheel` : "add dates to estimate driving"}
          </div>
        </div>

        {/* Planned cost — only when tracking */}
        {costs && (
          <div className="border-t border-rv-border-soft pt-3.5">
            <div className={`${kicker} mb-2`}>Planned cost</div>
            <div className="font-mono text-[26px] font-bold leading-none text-rv-green-cta">
              {money(summary.totalCost)}
            </div>
            <div className="mt-1 text-[12px] text-rv-ink-faded">so far</div>
          </div>
        )}

        {/* Stats */}
        <div className="flex flex-col gap-2.5 border-t border-rv-border-soft pt-3.5">
          <Stat Icon={Calendar} label="Length" value={`${summary.days} days`} />
          <Stat
            Icon={CircleAlert}
            warn
            label="Open"
            value={`${summary.openCount} day${summary.openCount === 1 ? "" : "s"} · ${summary.gapCount} gap${summary.gapCount === 1 ? "" : "s"}`}
          />
          <Stat
            Icon={MapPin}
            label="Stops"
            value={`${summary.stops} · ${summary.scheduled} set / ${summary.floating} floating`}
          />
        </div>

        <div className="h-px bg-rv-border-soft" />

        {/* Legs jump-links */}
        <div>
          <div className={`${kicker} mb-2`}>Legs</div>
          <div className="flex flex-col gap-0.5">
            {summary.legs.map((l) => (
              <a
                key={l.id}
                href={`#route-${l.id}`}
                className="flex items-baseline justify-between gap-2 rounded-rv-md px-2 py-1.5 no-underline transition-colors hover:bg-rv-green-soft"
              >
                <span className="text-[13px] font-semibold text-rv-navy">{l.name}</span>
                <span className="font-mono text-[11px] text-rv-ink-faded">
                  {l.stops} stop{l.stops === 1 ? "" : "s"}
                  {costs ? ` · ${money(l.cost)}` : ""}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
