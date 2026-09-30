"use client";

import { useState, type ReactNode } from "react";
import { Library } from "lucide-react";
import {
  isScheduled,
  orderedStops,
  type DateRangeValue,
  type DateSpan,
  type Idea,
  type Trip,
} from "@rv-trip/core";
import { DrillRow, FilterChip, RangePicker, ShelfIdeaCard, ideaCategoryType } from "@rv-trip/ui";
import { ChangeBylinePopover } from "@/components/history/ChangeBylinePopover";
import { GoogleLine } from "@/components/places/GoogleLine";
import type { IdeaShelf, ShelfFilter } from "@/lib/trip-logic";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MENU_ITEM, MENU_SURFACE, MenuHint } from "./row-menu";

/**
 * #131 · Q1 A — the Ideas tab: every maybe in one place, with an obvious way
 * onto the plan.
 *
 * The Timeline rail's shelf, "Last time here" and the nearby-saves banner live
 * here now (they sat above the lenses). Stop-pinned maybes group under their
 * stop; the trip's unattached ones sit under "For the trip". **Plan it** is the
 * promotion bridge that replaces the drag-to-gantt:
 *
 *   - a stay idea opens the RangePicker and becomes a stop (`onPlanStay`);
 *   - a do/eat idea picks its stop (`onPlanToStop` — attach + planned);
 *   - an idea already pinned to a stop is simply marked planned.
 */
export interface IdeasLensProps {
  trip: Trip;
  shelf: IdeaShelf;
  shelfFilter: ShelfFilter;
  onShelfFilter: (f: ShelfFilter) => void;
  /** LastTimeHere, the nearby banner, the drafts — rendered above the list. */
  top: ReactNode;
  onAddFromPlaces: () => void;
  // the shelf card's own writes (#80 / #82) — unchanged
  onCycleIdea: (ideaId: string) => void;
  onLocateIdea: (ideaId: string) => void;
  onRateIdea: (ideaId: string, n: number) => void;
  onNoteIdea: (ideaId: string, v: string) => void;
  onCommitIdeaNote: (ideaId: string) => void;
  ideaPicker?: (idea: Idea) => ReactNode;
  ideaActions?: (idea: Idea) => ReactNode;
  // the pinned rows' pill
  onCyclePinned: (stopId: string, ideaId: string) => void;
  // Plan it
  onPlanStay: (ideaId: string, span: DateSpan) => void;
  onPlanToStop: (ideaId: string, stopId: string) => void;
  onPlanPinned: (stopId: string, ideaId: string) => void;
}

/** How many maybes the tab badge counts: the shelf plus every stop-pinned idea
 * still at status `idea`. */
export function maybeCount(trip: Trip): number {
  return (
    trip.ideas.filter((i) => i.status === "idea").length +
    trip.legs.flatMap((l) => l.stops).flatMap((s) => s.ideas).filter((i) => i.status === "idea").length
  );
}

const PLAN_IT =
  "inline-flex cursor-pointer items-center whitespace-nowrap rounded-rv-md border border-rv-green bg-transparent px-[9px] py-[3px] text-[12px] font-bold text-rv-green-ink";

export function IdeasLens(p: IdeasLensProps) {
  const [planningStay, setPlanningStay] = useState<Idea | null>(null);
  /** The shelf row whose research pad (#82) is open — one at a time. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const stops = orderedStops(p.trip);
  const pinned = stops
    .map((s) => ({ stop: s, ideas: s.ideas.filter((i) => i.status === "idea") }))
    .filter((g) => g.ideas.length > 0);
  const forTrip = p.shelf.groups.flatMap((g) => g.ideas);
  const total = p.shelf.total + pinned.reduce((n, g) => n + g.ideas.length, 0);

  const planIt = (idea: Idea) =>
    idea.category === "stay" ? (
      <button type="button" className={PLAN_IT} onClick={() => setPlanningStay(idea)}>
        Plan it
      </button>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger className={PLAN_IT} disabled={stops.length === 0}>
          Plan it
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={MENU_SURFACE}>
          {stops.map((s) => (
            <DropdownMenuItem key={s.id} className={MENU_ITEM} onSelect={() => p.onPlanToStop(idea.id, s.id)}>
              {s.place.name}
              <MenuHint>stop</MenuHint>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <div className="min-w-0 max-w-[760px]">
      {p.top}

      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-rv-ink">Ideas</span>
        <span className="font-mono text-[10.5px] text-rv-ink-faded">
          {total} {total === 1 ? "maybe" : "maybes"}
        </span>
        <button
          type="button"
          onClick={p.onAddFromPlaces}
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border-hi bg-transparent px-[11px] py-[5px] text-[11.5px] font-semibold text-rv-ink"
        >
          <Library className="size-3.5" />
          Add from Places
        </button>
      </div>

      {total === 0 ? (
        <div className="mt-3 rounded-rv-card border border-dashed border-rv-border-hi bg-rv-surface-alt p-4">
          <div className="text-[14px] font-bold text-rv-ink">What do you want to do, eat, or stay near?</div>
          <p className="m-0 mt-1 text-[13px] text-rv-ink-muted">
            Add a maybe with “+ Add”, or pull one in from your Places.
          </p>
        </div>
      ) : (
        <>
          {p.shelf.chips.length > 0 && (
            <div className="mb-3 mt-2 flex flex-wrap gap-1.5">
              {p.shelf.chips.map((c) => (
                <FilterChip
                  key={c.key}
                  label={c.label}
                  count={c.count}
                  active={sameFilter(c.filter, p.shelfFilter)}
                  tone={c.warn ? "warn" : "default"}
                  onClick={() => p.onShelfFilter(c.filter)}
                />
              ))}
            </div>
          )}

          {pinned.map(({ stop, ideas }) => (
            <div key={stop.id}>
              <GroupHead>
                Pinned to {stop.place.name} · {ideas.length}
              </GroupHead>
              {ideas.map((idea) => (
                <ShelfIdeaCard
                  key={idea.id}
                  idea={idea}
                  nearestStopName={stop.place.name}
                  actions={
                    <button type="button" className={PLAN_IT} onClick={() => p.onPlanPinned(stop.id, idea.id)}>
                      Plan it
                    </button>
                  }
                  onCycle={() => p.onCyclePinned(stop.id, idea.id)}
                />
              ))}
            </div>
          ))}

          {forTrip.length > 0 && (
            <GroupHead>
              For the trip · {forTrip.length}
            </GroupHead>
          )}
          {forTrip.map((row) => (
            <ShelfIdeaCard
              key={row.idea.id}
              idea={row.idea}
              nearestStopName={row.nearestStopName}
              distanceMi={row.distanceMi}
              expanded={expandedId === row.idea.id}
              onClick={() => setExpandedId((id) => (id === row.idea.id ? null : row.idea.id))}
              actions={
                <span className="inline-flex items-center gap-1.5">
                  {planIt(row.idea)}
                  {p.ideaActions?.(row.idea)}
                </span>
              }
              picker={p.ideaPicker?.(row.idea)}
              drill={<DrillRow name={row.idea.title} type={ideaCategoryType(row.idea.category)} />}
              gline={<GoogleLine googlePlaceId={row.idea.place?.googlePlaceId} />}
              byline={
                <ChangeBylinePopover
                  last={row.idea.lastChange}
                  entity="idea"
                  entityId={row.idea.id}
                  name={row.idea.title}
                />
              }
              onCycle={() => p.onCycleIdea(row.idea.id)}
              onLocate={() => p.onLocateIdea(row.idea.id)}
              onRating={(n) => p.onRateIdea(row.idea.id, n)}
              onNote={(v) => p.onNoteIdea(row.idea.id, v)}
              onCommitNote={() => p.onCommitIdeaNote(row.idea.id)}
            />
          ))}
        </>
      )}

      {planningStay && (
        <PlanStayDialog
          trip={p.trip}
          idea={planningStay}
          onClose={() => setPlanningStay(null)}
          onPlan={(span) => {
            setPlanningStay(null);
            p.onPlanStay(planningStay.id, span);
          }}
        />
      )}
    </div>
  );
}

function GroupHead({ children }: { children: ReactNode }) {
  return (
    <div className="mb-[5px] mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-rv-ink-faded">
      {children}
    </div>
  );
}

/** Plan it on a stay idea: pick its nights, and it becomes a stop. Defaults to
 * the trip's first open run — or the whole trip when nothing is scheduled. */
function PlanStayDialog({
  trip,
  idea,
  onClose,
  onPlan,
}: {
  trip: Trip;
  idea: Idea;
  onClose: () => void;
  onPlan: (span: DateSpan) => void;
}) {
  const scheduled = trip.legs.flatMap((l) => l.stops).some(isScheduled);
  const [range, setRange] = useState<DateRangeValue>(
    scheduled ? { start: null, end: null } : { start: trip.startDate, end: trip.endDate },
  );
  const complete = range.start !== null && range.end !== null ? { start: range.start, end: range.end } : null;
  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[430px]">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-[17px] font-extrabold text-rv-ink">Plan {idea.title}</DialogTitle>
          <DialogDescription className="text-[11.5px] text-rv-ink-faded">
            Pick its nights — it becomes a stop on the Itinerary.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 flex flex-col gap-2.5">
          <RangePicker value={range} tripSpan={{ start: trip.startDate, end: trip.endDate }} onChange={setRange} />
          <button
            type="button"
            disabled={!complete}
            onClick={() => complete && onPlan(complete)}
            className="inline-flex cursor-pointer items-center justify-center rounded-rv-card border-none bg-rv-accent-deep px-3.5 py-[9px] text-[13px] font-extrabold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
          >
            Plan it
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sameFilter(a: ShelfFilter, b: ShelfFilter): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "near" || a.stopId === (b as { kind: "near"; stopId: string }).stopId;
}
