"use client";

import { useMemo, useState } from "react";
import type { Trip, ReservationType } from "@rv-trip/core";
import { Compass, House, CalendarDays, CircleAlert, Route, ChartNoAxesGantt, Plus } from "lucide-react";
import {
  timelineModel,
  routeModel,
  stopMap,
  setStopRating,
  setStopNote,
  setReservationRating,
  setReservationNote,
  addReservation,
  cycleIdeaStatus,
  setIdeaRating,
  setIdeaNote,
  promoteIdea,
  scheduleFloating,
  reorderFloating,
} from "@/lib/trip-logic";
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

export function TripPlanner({ trip: initialTrip }: { trip: Trip }) {
  const [trip, setTrip] = useState(initialTrip);
  const [lens, setLens] = useState<"timeline" | "route">("timeline");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddForm>({ type: "campground", name: "", dates: "", cost: "" });
  const [ideaNoteOpen, setIdeaNoteOpen] = useState<Set<string>>(new Set());
  const [routeDrag, setRouteDrag] = useState<{ legId: string; stopId: string } | null>(null);

  const timeline = useMemo(() => timelineModel(trip), [trip]);
  const route = useMemo(() => routeModel(trip), [trip]);
  const selectedStop = selectedId ? (stopMap(trip).get(selectedId) ?? null) : null;
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

  const submitAdd = () => {
    if (!form.name.trim()) return;
    setTrip((t) =>
      addReservation(t, selectedId!, {
        type: form.type,
        name: form.name.trim(),
        cost: form.cost ? Number(form.cost) : null,
        checkIn: null,
      }),
    );
    setForm({ type: "campground", name: "", dates: "", cost: "" });
    setAddOpen(false);
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
          <Timeline
            model={timeline}
            onOpenStop={openStop}
            onSchedule={(stopId) => setTrip((t) => scheduleFloating(t, stopId))}
          />
        ) : (
          <RouteView
            legs={route}
            onOpenStop={openStop}
            routeDrag={routeDrag}
            onRowDragStart={(legId, stopId) => setRouteDrag({ legId, stopId })}
            onRowDragEnd={() => setRouteDrag(null)}
            onRowDrop={(legId, targetId) => {
              if (routeDrag && routeDrag.legId === legId) {
                setTrip((t) => reorderFloating(t, legId, routeDrag.stopId, targetId));
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
          addOpen={addOpen}
          form={form}
          ideaNoteOpen={ideaNoteOpen}
          onClose={closeStop}
          onSchedule={() => setTrip((t) => scheduleFloating(t, selectedStop.id))}
          onSetRating={(n) => setTrip((t) => setStopRating(t, selectedStop.id, n))}
          onSetNote={(v) => setTrip((t) => setStopNote(t, selectedStop.id, v))}
          onToggleAdd={() => setAddOpen((v) => !v)}
          onFormChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onSubmitAdd={submitAdd}
          onResRating={(resId, n) => setTrip((t) => setReservationRating(t, selectedStop.id, resId, n))}
          onResNote={(resId, v) => setTrip((t) => setReservationNote(t, selectedStop.id, resId, v))}
          onIdeaCycle={(ideaId) => setTrip((t) => cycleIdeaStatus(t, selectedStop.id, ideaId))}
          onIdeaRating={(ideaId, n) => setTrip((t) => setIdeaRating(t, selectedStop.id, ideaId, n))}
          onIdeaNote={(ideaId, v) => setTrip((t) => setIdeaNote(t, selectedStop.id, ideaId, v))}
          onIdeaToggleNote={toggleIdeaNote}
          onPromote={(ideaId) => setTrip((t) => promoteIdea(t, selectedStop.id, ideaId))}
        />
      )}
    </div>
  );
}

function Dot() {
  return <span className="size-[3px] rounded-full bg-rv-ink-subtle" />;
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
