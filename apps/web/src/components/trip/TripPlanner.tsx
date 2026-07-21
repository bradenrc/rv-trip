"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Trip, Reservation, ReservationType } from "@rv-trip/core";
import { Compass, House, CalendarDays, CircleAlert, Route, ChartNoAxesGantt, Plus } from "lucide-react";
import {
  timelineModel,
  routeModel,
  routeSummary,
  stopMap,
  updateStop,
  setStopRating,
  setStopNote,
  setReservationRating,
  setReservationNote,
  cycleIdeaStatus,
  setIdeaRating,
  setIdeaNote,
  scheduleFloating,
  reorderFloating,
} from "@/lib/trip-logic";
import { tripApi } from "@/lib/trip-api";
import { fullRange } from "@/lib/trip-ui";
import { Timeline } from "./Timeline";
import { RouteView } from "./RouteView";
import { StopDetailSheet } from "./StopDetailSheet";

export interface AddForm {
  type: ReservationType;
  name: string;
  dates: string;
  cost: string;
}

/** Map a DB reservation row (cost-as-string, nullable cols) to the core shape. */
function mapRes(row: Record<string, unknown>): Reservation {
  return {
    id: row.id as string,
    stopId: row.stopId as string,
    ideaId: (row.ideaId as string | null) ?? null,
    type: row.type as ReservationType,
    name: row.name as string,
    checkIn: (row.checkIn as string | null) ?? null,
    checkOut: (row.checkOut as string | null) ?? null,
    confirmationNumber: (row.confirmationNumber as string | null) ?? null,
    cost: row.cost == null ? null : Number(row.cost),
    rating: (row.rating as number | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

const persist = (p: Promise<unknown>) =>
  p.catch(() => toast.error("That change didn't save — check your connection."));

export function TripPlanner({ trip: initialTrip }: { trip: Trip }) {
  const [trip, setTrip] = useState(initialTrip);
  const [lens, setLens] = useState<"timeline" | "route">("timeline");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddForm>({ type: "campground", name: "", dates: "", cost: "" });
  const [ideaNoteOpen, setIdeaNoteOpen] = useState<Set<string>>(new Set());
  const [routeDrag, setRouteDrag] = useState<{ legId: string; stopId: string } | null>(null);
  const [costTracking, setCostTracking] = useState(false);
  useEffect(() => {
    setCostTracking(localStorage.getItem("rv-track-costs") === "1");
  }, []);
  const changeCostTracking = (on: boolean) => {
    setCostTracking(on);
    localStorage.setItem("rv-track-costs", on ? "1" : "0");
  };

  const timeline = useMemo(() => timelineModel(trip), [trip]);
  const route = useMemo(() => routeModel(trip), [trip]);
  const summary = useMemo(() => routeSummary(trip), [trip]);
  const byId = useMemo(() => stopMap(trip), [trip]);
  const selectedStop = selectedId ? (byId.get(selectedId) ?? null) : null;
  const selectedLegName = selectedStop
    ? (trip.legs.find((l) => l.id === selectedStop.legId)?.title ?? "")
    : "";

  const openStop = (id: string) => {
    setSelectedId(id);
    setAddOpen(false);
  };
  const closeStop = () => {
    setSelectedId(null);
    setAddOpen(false);
  };
  const toggleIdeaNote = (ideaId: string) =>
    setIdeaNoteOpen((prev) => {
      const next = new Set(prev);
      next.has(ideaId) ? next.delete(ideaId) : next.add(ideaId);
      return next;
    });

  // ── mutations: optimistic local update + persist ─────────────────────────
  const doSchedule = (id: string) => {
    const next = scheduleFloating(trip, id);
    setTrip(next);
    const s = stopMap(next).get(id);
    if (s?.arriveDate && s?.departDate) {
      persist(tripApi.updateStop(id, { arriveDate: s.arriveDate, departDate: s.departDate }));
    }
  };

  const submitAdd = async () => {
    if (!form.name.trim() || !selectedId) return;
    try {
      const row = await tripApi.createReservation({
        stopId: selectedId,
        type: form.type,
        name: form.name.trim(),
        cost: form.cost ? Number(form.cost) : null,
        checkIn: null,
      });
      setTrip((t) =>
        updateStop(t, selectedId, (s) => ({ ...s, reservations: [...s.reservations, mapRes(row)] })),
      );
      setForm({ type: "campground", name: "", dates: "", cost: "" });
      setAddOpen(false);
    } catch {
      toast.error("Couldn't save that reservation.");
    }
  };

  const doPromote = async (ideaId: string) => {
    if (!selectedStop) return;
    const stopId = selectedStop.id;
    try {
      const row = await tripApi.promoteIdea(ideaId);
      setTrip((t) =>
        updateStop(t, stopId, (s) => ({
          ...s,
          ideas: s.ideas.filter((i) => i.id !== ideaId),
          reservations: [...s.reservations, mapRes(row)],
        })),
      );
    } catch {
      toast.error("Couldn't book that idea.");
    }
  };

  const dayCount = timeline.rhythm.length;

  return (
    <div className="min-h-screen bg-rv-surface-alt font-sans text-rv-ink">
      <div className="mx-auto max-w-[1240px] px-6 py-8">
        {/* Masthead */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="mb-2.5 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-green-cta">
              <Compass className="size-3.5" />
              <span>RV Trip Hub · Trip Planner</span>
            </div>
            <h1 className="m-0 mb-2.5 text-[44px] font-extrabold leading-none tracking-[-0.02em] text-rv-navy">
              {trip.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[15px] text-rv-ink-muted">
              {trip.homeBase && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <House className="size-4 text-rv-green" />
                    Home base — {trip.homeBase}
                  </span>
                  <Dot />
                </>
              )}
              <span className="inline-flex items-center gap-1.5 font-mono text-[13px]">
                <CalendarDays className="size-4 text-rv-green" />
                {fullRange(trip.startDate, trip.endDate)}
              </span>
              <Dot />
              <span className="font-mono text-[13px]">{dayCount} days</span>
              <Dot />
              <span className="inline-flex items-center gap-1.5 text-rv-warning">
                <CircleAlert className="size-4" />
                {timeline.openLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-rv-pill border border-rv-border bg-rv-surface p-[3px]">
              <ToggleTab active={lens === "route"} onClick={() => setLens("route")}>
                <Route className="size-4" />
                Route
              </ToggleTab>
              <ToggleTab active={lens === "timeline"} onClick={() => setLens("timeline")}>
                <ChartNoAxesGantt className="size-4" />
                Timeline
              </ToggleTab>
            </div>
            <CostSwitch checked={costTracking} onChange={changeCostTracking} />
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-green-cta px-4 py-[9px] text-[14px] font-semibold text-rv-surface"
            >
              <Plus className="size-4" />
              Add stop
            </button>
          </div>
        </div>

        {lens === "timeline" ? (
          <Timeline model={timeline} onOpenStop={openStop} onSchedule={doSchedule} />
        ) : (
          <RouteView
            legs={route}
            summary={summary}
            costs={costTracking}
            onOpenStop={openStop}
            routeDrag={routeDrag}
            onRowDragStart={(legId, stopId) => setRouteDrag({ legId, stopId })}
            onRowDragEnd={() => setRouteDrag(null)}
            onRowDrop={(legId, targetId) => {
              if (routeDrag && routeDrag.legId === legId) {
                const next = reorderFloating(trip, legId, routeDrag.stopId, targetId);
                setTrip(next);
                const leg = next.legs.find((l) => l.id === legId);
                if (leg) {
                  const order = [...leg.stops].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id);
                  persist(tripApi.reorderLeg(legId, order));
                }
              }
              setRouteDrag(null);
            }}
          />
        )}
      </div>

      {selectedStop && (
        <StopDetailSheet
          stop={selectedStop}
          legName={selectedLegName}
          costs={costTracking}
          addOpen={addOpen}
          form={form}
          ideaNoteOpen={ideaNoteOpen}
          onClose={closeStop}
          onSchedule={() => doSchedule(selectedStop.id)}
          onSetRating={(n) => {
            const next = setStopRating(trip, selectedStop.id, n);
            setTrip(next);
            persist(tripApi.updateStop(selectedStop.id, { rating: stopMap(next).get(selectedStop.id)?.rating ?? null }));
          }}
          onSetNote={(v) => setTrip((t) => setStopNote(t, selectedStop.id, v))}
          onCommitNote={() =>
            persist(tripApi.updateStop(selectedStop.id, { notes: byId.get(selectedStop.id)?.notes ?? "" }))
          }
          onToggleAdd={() => setAddOpen((v) => !v)}
          onFormChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onSubmitAdd={submitAdd}
          onResRating={(resId, n) => {
            const next = setReservationRating(trip, selectedStop.id, resId, n);
            setTrip(next);
            const r = stopMap(next).get(selectedStop.id)?.reservations.find((x) => x.id === resId);
            persist(tripApi.updateReservation(resId, { rating: r?.rating ?? null }));
          }}
          onResNote={(resId, v) => setTrip((t) => setReservationNote(t, selectedStop.id, resId, v))}
          onCommitResNote={(resId) => {
            const r = byId.get(selectedStop.id)?.reservations.find((x) => x.id === resId);
            persist(tripApi.updateReservation(resId, { notes: r?.notes ?? "" }));
          }}
          onIdeaCycle={(ideaId) => {
            const next = cycleIdeaStatus(trip, selectedStop.id, ideaId);
            setTrip(next);
            const it = stopMap(next).get(selectedStop.id)?.ideas.find((x) => x.id === ideaId);
            if (it) persist(tripApi.updateIdea(ideaId, { status: it.status }));
          }}
          onIdeaRating={(ideaId, n) => {
            const next = setIdeaRating(trip, selectedStop.id, ideaId, n);
            setTrip(next);
            const it = stopMap(next).get(selectedStop.id)?.ideas.find((x) => x.id === ideaId);
            persist(tripApi.updateIdea(ideaId, { rating: it?.rating ?? null }));
          }}
          onIdeaNote={(ideaId, v) => setTrip((t) => setIdeaNote(t, selectedStop.id, ideaId, v))}
          onCommitIdeaNote={(ideaId) => {
            const it = byId.get(selectedStop.id)?.ideas.find((x) => x.id === ideaId);
            persist(tripApi.updateIdea(ideaId, { notes: it?.notes ?? "" }));
          }}
          onIdeaToggleNote={toggleIdeaNote}
          onPromote={doPromote}
        />
      )}
    </div>
  );
}

function Dot() {
  return <span className="size-[3px] rounded-full bg-rv-ink-subtle" />;
}

function CostSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2 border-none bg-transparent p-0"
    >
      <span className={`text-[13px] font-semibold ${checked ? "text-rv-ink" : "text-rv-ink-faded"}`}>
        Track costs
      </span>
      <span
        className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
          checked ? "bg-rv-green" : "bg-rv-border-hi"
        }`}
      >
        <span
          className="absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
    </button>
  );
}

function ToggleTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border-none px-[15px] py-[7px] text-[13px] font-semibold ${
        active ? "bg-rv-navy text-rv-surface" : "bg-transparent text-rv-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}
