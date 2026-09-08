"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Trip, Reservation, ReservationType, TripSettingsDraft } from "@rv-trip/core";
import {
  cascadeLossSentence,
  isScheduled,
  orderedPairs,
  orphanedStopsMessage,
  routeCacheKey,
  stopsOutsideRange,
  tripCascadeCounts,
  tripDayCount,
  tripSettingsDraft,
  tripSettingsPatch,
} from "@rv-trip/core";
import { FieldLabel, Stars } from "@rv-trip/ui";
import {
  Compass,
  House,
  CalendarDays,
  CircleAlert,
  Route,
  ChartNoAxesGantt,
  Plus,
  Settings,
} from "lucide-react";
import {
  allStops,
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
  type RouteMap,
} from "@/lib/trip-logic";
import { tripApi } from "@/lib/trip-api";
import { fullRange } from "@/lib/trip-ui";
import { useBooleanPref } from "@/lib/pref";
import { InlineText } from "@/components/ui/inline-text";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export function TripPlanner({
  trip: initialTrip,
  routes: initialRoutes,
  rigHash,
  hasRig,
}: {
  trip: Trip;
  /** Server-resolved drives, keyed `from|to|rigHash`. */
  routes: RouteMap;
  rigHash: string;
  hasRig: boolean;
}) {
  const router = useRouter();
  const [trip, setTrip] = useState(initialTrip);
  const [routes, setRoutes] = useState(initialRoutes);
  const [lens, setLens] = useState<"timeline" | "route">("timeline");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddForm>({
    type: "campground",
    name: "",
    dates: "",
    cost: "",
  });
  const [ideaNoteOpen, setIdeaNoteOpen] = useState<Set<string>>(new Set());
  const [routeDrag, setRouteDrag] = useState<{
    legId: string;
    stopId: string;
  } | null>(null);
  // Cost tracking is opt-in — planning without money in your face is the default.
  const [costTracking, changeCostTracking] = useBooleanPref("rv-track-costs");
  /**
   * The trip as it was before the note being typed right now. A note is
   * optimistic on every keystroke and persisted on blur, so the trip in hand at
   * commit time already carries the typed text — this is the only snapshot that
   * can honestly put the old note back. One ref is enough: only one note is
   * ever open.
   */
  const noteUndo = useRef<Trip | null>(null);

  /**
   * Every write: the optimistic change is already on screen, so a failure
   * restores the trip (and the routes) we were holding before it and says what
   * it undid. No retry — the caller re-does the gesture.
   */
  const persist = (p: Promise<unknown>, undo: Trip, msg: string) => {
    const undoRoutes = routes;
    return p.catch(() => {
      setTrip(undo);
      setRoutes(undoRoutes);
      toast.error(msg);
    });
  };

  /** Take (and clear) the pre-edit snapshot a note commit rolls back to. */
  const takeNoteUndo = () => {
    const undo = noteUndo.current ?? trip;
    noteUndo.current = null;
    return undo;
  };
  /** Remember the trip the first keystroke of a note edit landed on. */
  const beginNoteEdit = () => {
    noteUndo.current ??= trip;
  };

  const timeline = useMemo(() => timelineModel(trip), [trip]);
  const route = useMemo(() => routeModel(trip, routes, rigHash), [trip, routes, rigHash]);
  const summary = useMemo(() => routeSummary(trip, routes, rigHash), [trip, routes, rigHash]);
  const byId = useMemo(() => stopMap(trip), [trip]);
  // Trip-wide scheduled sequence — the same ordering routeSummary() and /map use.
  const scheduledOrdinal = useMemo(
    () =>
      new Map(
        trip.legs
          .flatMap((l) => l.stops)
          .filter(isScheduled)
          .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!))
          .map((s, i) => [s.id, i + 1] as const),
      ),
    [trip],
  );
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
      if (next.has(ideaId)) next.delete(ideaId);
      else next.add(ideaId);
      return next;
    });

  // ── mutations: optimistic local update + persist ─────────────────────────
  const doSchedule = (id: string) => {
    const undo = trip;
    const next = scheduleFloating(trip, id);
    setTrip(next);
    upgradeRoutes(next);
    const s = stopMap(next).get(id);
    if (s?.arriveDate && s?.departDate) {
      persist(
        tripApi.updateStop(id, {
          arriveDate: s.arriveDate,
          departDate: s.departDate,
        }),
        undo,
        `Couldn't schedule ${s.place.name} — put back to floating.`,
      );
    }
  };

  /** The masthead's inline title. */
  const renameTrip = (title: string) => {
    const undo = trip;
    setTrip({ ...trip, title });
    persist(
      tripApi.updateTrip(trip.id, { title }),
      undo,
      `Couldn't rename ${undo.title} — the old name is back.`,
    );
  };

  /** The settings dialog. Only the changed fields travel. */
  const saveSettings = (draft: TripSettingsDraft) => {
    setSettingsOpen(false);
    const patch = tripSettingsPatch(trip, draft);
    if (Object.keys(patch).length === 0) return;
    const undo = trip;
    setTrip({ ...trip, ...patch });
    persist(
      tripApi.updateTrip(trip.id, patch),
      undo,
      "Couldn't save those settings — your changes are back as they were.",
    );
  };

  /**
   * Delete is the one write with nothing to be optimistic about: the surface it
   * would roll back to is the page itself, so it waits for the server and then
   * leaves for the dashboard.
   */
  const deleteTrip = async () => {
    setDeleteOpen(false);
    try {
      await tripApi.deleteTrip(trip.id);
      router.push("/");
      router.refresh();
    } catch {
      toast.error(`Couldn't delete ${trip.title} — nothing was removed.`);
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
        updateStop(t, selectedId, (s) => ({
          ...s,
          reservations: [...s.reservations, mapRes(row)],
        })),
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

  /**
   * Reordering invents pairs the server never routed. Those render immediately
   * from the synchronous straight-line estimate; this asks for the real ones in
   * the background. A failure is silent on purpose — the estimate is already on
   * screen and is honestly labelled.
   */
  const upgradeRoutes = (next: Trip) => {
    const missing = orderedPairs(next).filter(
      (p) => !routes[routeCacheKey(p.from, p.to, rigHash)],
    );
    if (missing.length === 0) return;
    tripApi
      .routePairs(missing.map((p) => ({ from: p.from, to: p.to })))
      // Merge ONLY when the reply was keyed with the rig this page rendered
      // against. Edit the rig in another tab and the server keys with the new
      // hash — merging those would add keys nothing ever looks up, so every
      // later reorder would re-request the same pairs forever. A mismatch
      // means the page is stale: the estimate stands until reload.
      .then((fresh) => {
        if (fresh.rigHash !== rigHash) return;
        setRoutes((prev) => ({ ...prev, ...fresh.routes }));
      })
      .catch(() => {});
  };

  const dayCount = timeline.rhythm.length;

  return (
    <div className="min-h-screen bg-rv-surface-alt font-sans text-rv-ink">
      <div className="mx-auto max-w-[1240px] px-6 py-8">
        {/* Masthead */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="mb-2.5 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-ember">
              <Compass className="size-3.5" />
              <span>RV Trip Hub · Trip Planner</span>
            </div>
            <h1 className="m-0 mb-2.5 text-[44px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
              <InlineText
                value={trip.title}
                onSave={renameTrip}
                label="Rename trip"
                className="text-[44px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink"
              />
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
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border-hi bg-transparent px-[11px] py-[5px] text-[11.5px] font-semibold text-rv-ink"
              >
                <Settings className="size-3.5" />
                Trip settings
              </button>
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
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-ember px-4 py-[9px] text-[14px] font-semibold text-rv-navy"
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
            hasRig={hasRig}
            onOpenStop={openStop}
            routeDrag={routeDrag}
            onRowDragStart={(legId, stopId) => setRouteDrag({ legId, stopId })}
            onRowDragEnd={() => setRouteDrag(null)}
            onRowDrop={(legId, targetId) => {
              if (routeDrag && routeDrag.legId === legId) {
                const undo = trip;
                const next = reorderFloating(trip, legId, routeDrag.stopId, targetId);
                setTrip(next);
                upgradeRoutes(next);
                const leg = next.legs.find((l) => l.id === legId);
                if (leg) {
                  const order = [...leg.stops]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((s) => s.id);
                  persist(
                    tripApi.reorderLeg(legId, order),
                    undo,
                    "Couldn't save that order — put back the way it was.",
                  );
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
          stopOrdinal={scheduledOrdinal.get(selectedStop.id) ?? null}
          costs={costTracking}
          addOpen={addOpen}
          form={form}
          ideaNoteOpen={ideaNoteOpen}
          onClose={closeStop}
          onSchedule={() => doSchedule(selectedStop.id)}
          onSetRating={(n) => {
            const undo = trip;
            const next = setStopRating(trip, selectedStop.id, n);
            setTrip(next);
            persist(
              tripApi.updateStop(selectedStop.id, {
                rating: stopMap(next).get(selectedStop.id)?.rating ?? null,
              }),
              undo,
              "Couldn't save that rating — the old rating is back.",
            );
          }}
          onSetNote={(v) => {
            beginNoteEdit();
            setTrip((t) => setStopNote(t, selectedStop.id, v));
          }}
          onCommitNote={() =>
            persist(
              tripApi.updateStop(selectedStop.id, {
                notes: byId.get(selectedStop.id)?.notes ?? "",
              }),
              takeNoteUndo(),
              "Couldn't save that note — the old note is back.",
            )
          }
          onToggleAdd={() => setAddOpen((v) => !v)}
          onFormChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onSubmitAdd={submitAdd}
          onResRating={(resId, n) => {
            const undo = trip;
            const next = setReservationRating(trip, selectedStop.id, resId, n);
            setTrip(next);
            const r = stopMap(next)
              .get(selectedStop.id)
              ?.reservations.find((x) => x.id === resId);
            persist(
              tripApi.updateReservation(resId, { rating: r?.rating ?? null }),
              undo,
              "Couldn't save that rating — the old rating is back.",
            );
          }}
          onResNote={(resId, v) => {
            beginNoteEdit();
            setTrip((t) => setReservationNote(t, selectedStop.id, resId, v));
          }}
          onCommitResNote={(resId) => {
            const r = byId.get(selectedStop.id)?.reservations.find((x) => x.id === resId);
            persist(
              tripApi.updateReservation(resId, { notes: r?.notes ?? "" }),
              takeNoteUndo(),
              "Couldn't save that note — the old note is back.",
            );
          }}
          onIdeaCycle={(ideaId) => {
            const undo = trip;
            const next = cycleIdeaStatus(trip, selectedStop.id, ideaId);
            setTrip(next);
            const it = stopMap(next)
              .get(selectedStop.id)
              ?.ideas.find((x) => x.id === ideaId);
            if (it) {
              persist(
                tripApi.updateIdea(ideaId, { status: it.status }),
                undo,
                "Couldn't save that status — put back the way it was.",
              );
            }
          }}
          onIdeaRating={(ideaId, n) => {
            const undo = trip;
            const next = setIdeaRating(trip, selectedStop.id, ideaId, n);
            setTrip(next);
            const it = stopMap(next)
              .get(selectedStop.id)
              ?.ideas.find((x) => x.id === ideaId);
            persist(
              tripApi.updateIdea(ideaId, { rating: it?.rating ?? null }),
              undo,
              "Couldn't save that rating — the old rating is back.",
            );
          }}
          onIdeaNote={(ideaId, v) => {
            beginNoteEdit();
            setTrip((t) => setIdeaNote(t, selectedStop.id, ideaId, v));
          }}
          onCommitIdeaNote={(ideaId) => {
            const it = byId.get(selectedStop.id)?.ideas.find((x) => x.id === ideaId);
            persist(
              tripApi.updateIdea(ideaId, { notes: it?.notes ?? "" }),
              takeNoteUndo(),
              "Couldn't save that note — the old note is back.",
            );
          }}
          onIdeaToggleNote={toggleIdeaNote}
          onPromote={doPromote}
        />
      )}

      <TripSettingsDialog
        trip={trip}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSave={saveSettings}
        onDelete={() => {
          setSettingsOpen(false);
          setDeleteOpen(true);
        }}
      />

      <DeleteTripConfirm
        trip={trip}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={deleteTrip}
      />
    </div>
  );
}

/** A dialog field's chrome — the app's one input skin, in the dialog's palette. */
const FIELD =
  "h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] text-[13px] text-rv-ink md:text-[13px]";
const FIELD_MONO =
  "h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] font-mono text-[12px] text-rv-ink md:text-[12px]";

/**
 * Trip settings — the medium weight: dates, home base, status, rating, note.
 *
 * The title is NOT here; it is the masthead's inline edit, and duplicating it
 * would give one value two save paths. Dates are the native `<input
 * type="date">` — the app ships no date picker.
 */
function TripSettingsDialog({
  trip,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  trip: Trip;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: TripSettingsDraft) => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so the draft is seeded from the trip on every
          open — that is what makes Cancel really discard. (Radix would keep the
          component itself mounted and only portal its content, so the state
          would otherwise survive the close.) */}
      {open && (
        <TripSettingsFields
          trip={trip}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </Dialog>
  );
}

function TripSettingsFields({
  trip,
  onCancel,
  onSave,
  onDelete,
}: {
  trip: Trip;
  onCancel: () => void;
  onSave: (draft: TripSettingsDraft) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<TripSettingsDraft>(() => tripSettingsDraft(trip));

  const set = (patch: Partial<TripSettingsDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const rangeOk = tripDayCount(draft.startDate, draft.endDate) !== null;
  // Refused, not clamped: deriveDays drops days outside the trip window, so a
  // range that leaves a scheduled stop outside it would make the stop invisible
  // rather than wrong. The client holds the whole tree, so it says so here —
  // with the same sentence the server's 409 carries.
  const orphans = rangeOk
    ? stopsOutsideRange({ startDate: draft.startDate, endDate: draft.endDate }, allStops(trip))
    : [];
  const canSave = rangeOk && orphans.length === 0;

  return (
    <DialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[470px]">
      <DialogHeader className="gap-1.5">
        <DialogTitle className="text-[17px] font-extrabold text-rv-ink">Trip settings</DialogTitle>
        <DialogDescription className="text-[11.5px] text-rv-ink-faded">
          {trip.title}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-3 flex flex-col gap-2.5">
        <div className="flex gap-2.5">
          <div className="flex flex-1 flex-col gap-1">
            <FieldLabel>Start</FieldLabel>
            <Input
              type="date"
              value={draft.startDate}
              onChange={(e) => set({ startDate: e.target.value })}
              className={FIELD_MONO}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <FieldLabel>End</FieldLabel>
            <Input
              type="date"
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
              className={FIELD_MONO}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel>Home base</FieldLabel>
          <Input
            value={draft.homeBase}
            onChange={(e) => set({ homeBase: e.target.value })}
            placeholder="Boise, ID"
            className={FIELD}
          />
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel>Status</FieldLabel>
          <Select
            value={draft.status}
            onValueChange={(v: string) => set({ status: v as TripSettingsDraft["status"] })}
          >
            <SelectTrigger className="h-auto w-full rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] text-[13px] text-rv-ink">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic — set by the dates</SelectItem>
              <SelectItem value="planning">Planning — set by me</SelectItem>
              <SelectItem value="upcoming">Upcoming — set by me</SelectItem>
              <SelectItem value="complete">Complete — set by me</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[11.5px] text-rv-ink-faded">
            Choosing a status pins it. Pick <b className="font-semibold">Automatic</b> to let the
            dates decide again.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel>
            Rating <span className="font-normal normal-case text-rv-ink-faded">Traveled trips</span>
          </FieldLabel>
          <Stars value={draft.rating} size={16} onSet={(n) => set({ rating: n })} />
        </div>

        <div className="flex flex-col gap-1">
          <FieldLabel>Note</FieldLabel>
          <Textarea
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="What you'd tell a friend about this trip…"
            className="min-h-[52px] rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-2 text-[13px] text-rv-ink md:text-[13px]"
          />
        </div>

        {!rangeOk && (
          <p className="m-0 rounded-rv-md bg-rv-warning-soft px-[11px] py-[9px] text-[12.5px] text-rv-warning">
            The end date is before the start date.
          </p>
        )}
        {orphans.length > 0 && (
          <p className="m-0 rounded-rv-md bg-rv-warning-soft px-[11px] py-[9px] text-[12.5px] text-rv-warning">
            {orphanedStopsMessage(orphans)}
          </p>
        )}
      </div>

      <div className="mt-[15px] flex items-center gap-[9px]">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!canSave}
          className="cursor-pointer rounded-rv-md border-none bg-rv-ember px-3.5 py-[7px] text-[12.5px] font-bold text-rv-navy disabled:cursor-default disabled:opacity-45"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-rv-md border border-rv-border-hi bg-transparent px-3.5 py-[7px] text-[12.5px] font-semibold text-rv-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto cursor-pointer rounded-rv-md border border-rv-warning bg-transparent px-[11px] py-[5px] text-[11.5px] font-semibold text-rv-warning"
        >
          Delete trip…
        </button>
      </div>
    </DialogContent>
  );
}

/**
 * The cascading delete's confirm. It names the loss with real counts — the
 * client holds the whole tree — and never asks "are you sure?". No destructive
 * variant: the action is the CTA colour (ember) because it is the thing you
 * came to do, and the loss is carried by the attention colour (amber).
 */
function DeleteTripConfirm({
  trip,
  open,
  onOpenChange,
  onConfirm,
}: {
  trip: Trip;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[470px]">
        <AlertDialogHeader className="gap-1.5 place-items-start text-left sm:place-items-start sm:text-left">
          <AlertDialogTitle className="text-[17px] font-extrabold text-rv-ink">
            Delete “{trip.title}”?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-rv-warning">
            {cascadeLossSentence(tripCascadeCounts(trip))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mx-0 mb-0 mt-[15px] flex-row justify-start gap-[9px] border-t-0 bg-transparent p-0 sm:justify-start">
          <AlertDialogCancel className="h-auto cursor-pointer rounded-rv-md border border-rv-border-hi bg-transparent px-3.5 py-[7px] text-[12.5px] font-semibold text-rv-ink">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="h-auto cursor-pointer rounded-rv-md border-none bg-rv-ember px-3.5 py-[7px] text-[12.5px] font-bold text-rv-navy"
          >
            Delete trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
        active ? "bg-rv-navy text-rv-ink" : "bg-transparent text-rv-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}
