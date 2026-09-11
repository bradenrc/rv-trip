"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  CascadeCounts,
  Idea,
  Reservation,
  ReservationDraft,
  ReservationType,
  Stop,
  StopDatesDraft,
  Trip,
  TripDateRange,
  TripSettingsDraft,
} from "@rv-trip/core";
import {
  BLANK_RESERVATION_DRAFT,
  UNDO_WINDOW_MS,
  cascadeLossSentence,
  ideaDraftInput,
  ideaRestoreInput,
  isScheduled,
  legCascadeCounts,
  nextLegTitle,
  orderedPairs,
  orphanedStopsMessage,
  reservationDraft,
  reservationDraftInput,
  reservationDraftPatch,
  reservationRestoreInput,
  routeCacheKey,
  stopCascadeCounts,
  stopDatesDraft,
  stopDatesOutsideTrip,
  stopDatesHelp,
  stopDatesPatch,
  stopOutsideTripMessage,
  stopsOutsideRange,
  tripCascadeCounts,
  tripDayCount,
  tripSettingsDraft,
  tripSettingsPatch,
  unscheduleStopPatch,
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
  appendIdea,
  appendLeg,
  appendReservation,
  appendStop,
  applyPromotion,
  canMoveLeg,
  legOrder,
  moveLeg,
  moveStopToLeg,
  removeIdea,
  removeLeg,
  removeReservation,
  removeStop,
  renameLeg,
  renameStop,
  setStopDates,
  timelineModel,
  routeModel,
  routeSummary,
  stopMap,
  setStopRating,
  setStopNote,
  setReservationRating,
  setReservationNote,
  setReservationFields,
  cycleIdeaStatus,
  setIdeaRating,
  setIdeaNote,
  scheduleFloating,
  reorderFloating,
  type RouteMap,
  type TimelineGap,
} from "@/lib/trip-logic";
import { tripApi } from "@/lib/trip-api";
import { fullRange, monthDay } from "@/lib/trip-ui";
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

/**
 * The name a just-created stop carries until you type over it. "Add stop" opens
 * that rename focused, so the placeholder is what you see for one keystroke —
 * not a name anyone has to live with. The place picker (#23) replaces this.
 */
const NEW_STOP_NAME = "New stop";

/**
 * The reservation form's state, and the shape the two write helpers in
 * `@rv-trip/core` speak. It used to be a local `AddForm` with a `dates` string
 * that was collected and never sent; it is now the draft the core schema is
 * derived from, so every field on a `reservation` is here and every one of them
 * reaches the API.
 */
type AddForm = ReservationDraft;

export function TripPlanner({
  trip: initialTrip,
  routes: initialRoutes,
  routingHash,
  hasRig,
}: {
  trip: Trip;
  /** Server-resolved drives, keyed `from|to|routingHash`. */
  routes: RouteMap;
  routingHash: string;
  hasRig: boolean;
}) {
  const router = useRouter();
  const [trip, setTrip] = useState(initialTrip);
  const [routes, setRoutes] = useState(initialRoutes);
  const [lens, setLens] = useState<"timeline" | "route">("timeline");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** The reservation form: `"new"` is the add form, an id is that row's full
   * edit, `null` is closed. One form, two jobs. */
  const [formTarget, setFormTarget] = useState<string | "new" | null>(null);
  /** The leg or stop whose inline rename is open — set by the row menu's
   * "Rename" and by a create, so a new row lands ready to be named. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [datesStopId, setDatesStopId] = useState<string | null>(null);
  const [deleteLegId, setDeleteLegId] = useState<string | null>(null);
  const [deleteStopId, setDeleteStopId] = useState<string | null>(null);
  const [form, setForm] = useState<AddForm>(BLANK_RESERVATION_DRAFT);
  const [ideaAddOpen, setIdeaAddOpen] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState("");
  /** The idea whose "Book as" picker is open, and the type it is set to. The
   * default is the `"activity"` the server used to hardcode. */
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteType, setPromoteType] = useState<ReservationType>("activity");
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
  const route = useMemo(() => routeModel(trip, routes, routingHash), [trip, routes, routingHash]);
  const summary = useMemo(
    () => routeSummary(trip, routes, routingHash),
    [trip, routes, routingHash],
  );
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
  // The three row-menu surfaces read their subject off the tree rather than
  // snapshotting it, so a rollback under an open dialog corrects what it shows.
  const deleteLeg = deleteLegId ? (trip.legs.find((l) => l.id === deleteLegId) ?? null) : null;
  const deleteStop = deleteStopId ? (byId.get(deleteStopId) ?? null) : null;
  const datesStop = datesStopId ? (byId.get(datesStopId) ?? null) : null;

  /** Every leaf surface is per-stop, so opening or closing the sheet closes all
   * of them — a form left open over another stop would write to the wrong row. */
  const resetLeafForms = () => {
    setFormTarget(null);
    setIdeaAddOpen(false);
    setIdeaDraft("");
    setPromotingId(null);
  };
  const openStop = (id: string) => {
    setSelectedId(id);
    resetLeafForms();
  };
  const closeStop = () => {
    setSelectedId(null);
    resetLeafForms();
  };
  const toggleIdeaNote = (ideaId: string) =>
    setIdeaNoteOpen((prev) => {
      const next = new Set(prev);
      if (next.has(ideaId)) next.delete(ideaId);
      else next.add(ideaId);
      return next;
    });

  // ── mutations: optimistic local update + persist ─────────────────────────

  /**
   * The gantt drop — and the stop sheet's "Schedule" button, which has no drop
   * target and passes no gap.
   *
   * `gap` is the open span the card was dropped ON: the stop takes that gap's
   * first date and `min(3, gap.span)` days of it, so dropping on Aug 10–11
   * lands on Aug 10–11 rather than on the trip's longest empty run. `null`
   * keeps the longest-run fallback the sheet's button has always used.
   *
   * Two fields, one PATCH — no `sortOrder` write. `orderedLegStops()` sorts
   * scheduled stops by `arriveDate`, so the dates alone reorder the leg
   * everywhere the stop appears.
   */
  const doSchedule = (id: string, gap: TimelineGap | null = null) => {
    const undo = trip;
    const next = scheduleFloating(trip, id, gap);
    if (next === undo) return; // no open day to land on — nothing happened
    setTrip(next);
    upgradeRoutes(next);
    const s = stopMap(next).get(id);
    if (!s?.arriveDate || !s.departDate) return;
    const arriveDate = s.arriveDate;
    const departDate = s.departDate;
    persist(
      tripApi.updateStop(id, { arriveDate, departDate }),
      undo,
      `Couldn't schedule ${s.place.name} — put back to floating.`,
    );
    // The drop is the one gesture with no dialog in front of it, so the toast
    // is where it becomes reversible: Undo puts the stop back to floating and
    // writes that back too.
    toast.success(`Scheduled ${s.place.name} · ${monthDay(arriveDate)} – ${monthDay(departDate)}`, {
      action: {
        label: "Undo",
        onClick: () => {
          setTrip(undo);
          persist(
            tripApi.updateStop(id, { arriveDate: null, departDate: null }),
            next,
            `Couldn't undo — ${s.place.name} still has dates.`,
          );
        },
      },
    });
  };

  // ── legs ─────────────────────────────────────────────────────────────────
  //
  // A CREATE is the one write with nothing to be optimistic about — only the
  // server can mint the id — so it awaits the 201 and splices the row it hands
  // back. Everything else applies to the tree first and hands persist() the
  // trip it was applied to, which is what a failure puts back.

  const addLeg = async () => {
    try {
      const leg = await tripApi.createLeg({ tripId: trip.id, title: nextLegTitle(trip) });
      setTrip((t) => appendLeg(t, leg));
      setLens("route");
      setRenamingId(leg.id);
    } catch {
      toast.error("Couldn't add a leg — nothing was created.");
    }
  };

  const doRenameLeg = (legId: string, title: string) => {
    const undo = trip;
    const was = trip.legs.find((l) => l.id === legId)?.title ?? "that leg";
    setTrip(renameLeg(trip, legId, title));
    persist(
      tripApi.updateLeg(legId, { title }),
      undo,
      `Couldn't rename ${was} — the old name is back.`,
    );
  };

  /** "Move leg up/down" — the whole new order travels, never a swap. */
  const doMoveLeg = (legId: string, delta: -1 | 1) => {
    const undo = trip;
    const next = moveLeg(trip, legId, delta);
    if (next === undo) return;
    setTrip(next);
    upgradeRoutes(next);
    persist(
      tripApi.reorderLegs(trip.id, legOrder(next)),
      undo,
      "Couldn't save that order — put back the way it was.",
    );
  };

  const doDeleteLeg = (legId: string) => {
    setDeleteLegId(null);
    const leg = trip.legs.find((l) => l.id === legId);
    if (!leg) return;
    const undo = trip;
    // The sheet cannot outlive the stop it is showing.
    if (leg.stops.some((s) => s.id === selectedId)) closeStop();
    setTrip(removeLeg(trip, legId));
    persist(
      tripApi.deleteLeg(legId),
      undo,
      `Couldn't delete ${leg.title} — the leg and its stops are back.`,
    );
  };

  // ── stops ────────────────────────────────────────────────────────────────

  /** Born floating and unnamed, with its inline rename already open — the
   * place picker (#23) is what will eventually fill the name in for you. */
  const addStop = async (legId: string) => {
    try {
      const created = await tripApi.createStop({
        legId,
        place: { name: NEW_STOP_NAME, lat: null, lng: null, googlePlaceId: null },
        arriveDate: null,
        departDate: null,
      });
      setTrip((t) => appendStop(t, created));
      setLens("route");
      setRenamingId(created.id);
    } catch {
      toast.error("Couldn't add a stop — nothing was created.");
    }
  };

  const doRenameStop = (stopId: string, name: string) => {
    const undo = trip;
    const was = byId.get(stopId)?.place.name ?? "that stop";
    setTrip(renameStop(trip, stopId, name));
    persist(
      tripApi.updateStop(stopId, { placeName: name }),
      undo,
      `Couldn't rename ${was} — the old name is back.`,
    );
  };

  /** The stop-dates dialog's Save. Both dates travel together. */
  const saveStopDates = (stopId: string, draft: StopDatesDraft) => {
    setDatesStopId(null);
    const stop = byId.get(stopId);
    if (!stop) return;
    const patch = stopDatesPatch(stop, draft);
    if (patch === null || Object.keys(patch).length === 0) return;
    const undo = trip;
    const next = setStopDates(trip, stopId, patch.arriveDate ?? null, patch.departDate ?? null);
    setTrip(next);
    upgradeRoutes(next);
    persist(
      tripApi.updateStop(stopId, patch),
      undo,
      `Couldn't save those dates — ${stop.place.name} is back where it was.`,
    );
  };

  /** One PATCH setting BOTH dates to null: the stop drops back to floating. */
  const doUnschedule = (stopId: string) => {
    setDatesStopId(null);
    const stop = byId.get(stopId);
    if (!stop || !isScheduled(stop)) return;
    const undo = trip;
    const next = setStopDates(trip, stopId, null, null);
    setTrip(next);
    upgradeRoutes(next);
    persist(
      tripApi.updateStop(stopId, unscheduleStopPatch()),
      undo,
      `Couldn't unschedule ${stop.place.name} — the dates are back.`,
    );
  };

  const doMoveStopToLeg = (stopId: string, legId: string) => {
    const undo = trip;
    const next = moveStopToLeg(trip, stopId, legId);
    if (next === undo) return;
    const moved = stopMap(next).get(stopId);
    if (!moved) return;
    setTrip(next);
    upgradeRoutes(next);
    persist(
      // The destination leg AND the position it was appended at — the server
      // appends too, but only the client knows the row is going to the end of
      // a leg it is already holding.
      tripApi.updateStop(stopId, { legId, sortOrder: moved.sortOrder }),
      undo,
      `Couldn't move ${moved.place.name} — it's back in the leg it came from.`,
    );
  };

  const doDeleteStop = (stopId: string) => {
    setDeleteStopId(null);
    const stop = byId.get(stopId);
    if (!stop) return;
    const undo = trip;
    if (selectedId === stopId) closeStop();
    setTrip(removeStop(trip, stopId));
    persist(
      tripApi.deleteStop(stopId),
      undo,
      `Couldn't delete ${stop.place.name} — the stop is back.`,
    );
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

  // ── the two leaves: reservations and ideas ───────────────────────────────
  //
  // Neither cascades, so neither gets a confirm dialog. A delete happens
  // immediately, optimistically, and the toast is where it becomes reversible
  // for six seconds — Undo re-POSTs the row, because the DELETE has already
  // committed by the time the toast is gone and the id is not coming back.

  const openAddReservation = () => {
    setForm(BLANK_RESERVATION_DRAFT);
    setFormTarget("new");
  };

  /** The full edit: the same form, seeded from the row it is editing. */
  const openEditReservation = (resId: string) => {
    const r = selectedStop?.reservations.find((x) => x.id === resId);
    if (!r) return;
    setForm(reservationDraft(r));
    setFormTarget(resId);
  };

  const submitReservationForm = async () => {
    if (!selectedId || !formTarget) return;
    if (formTarget === "new") {
      const body = reservationDraftInput(selectedId, form);
      if (!body) return;
      const stopId = selectedId;
      try {
        // A create is the one write with nothing to be optimistic about: only
        // the server can mint the id, so it awaits the 201 and splices the row.
        const row = await tripApi.createReservation(body);
        setTrip((t) => appendReservation(t, stopId, row));
        setForm(BLANK_RESERVATION_DRAFT);
        setFormTarget(null);
      } catch {
        toast.error("Couldn't save that reservation.");
      }
      return;
    }
    const r = selectedStop?.reservations.find((x) => x.id === formTarget);
    if (!r) return;
    const patch = reservationDraftPatch(r, form);
    if (patch === null) return;
    setFormTarget(null);
    if (Object.keys(patch).length === 0) return;
    const undo = trip;
    setTrip(setReservationFields(trip, r.stopId, r.id, patch));
    persist(
      tripApi.updateReservation(r.id, patch),
      undo,
      `Couldn't save ${r.name} — your changes are back as they were.`,
    );
  };

  const doDeleteReservation = (resId: string) => {
    const r = selectedStop?.reservations.find((x) => x.id === resId);
    if (!r) return;
    if (formTarget === resId) setFormTarget(null);
    const undo = trip;
    const next = removeReservation(trip, r.stopId, resId);
    setTrip(next);
    persist(
      tripApi.deleteReservation(resId),
      undo,
      `Couldn't delete ${r.name} — the reservation is back.`,
    );
    toast.success(`Deleted ${r.name}`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => void restoreReservation(r),
      },
    });
  };

  /** Undo. The row comes back with a NEW id — same fields, rating and note. */
  const restoreReservation = async (r: Reservation) => {
    try {
      const row = await tripApi.createReservation(reservationRestoreInput(r));
      setTrip((t) => appendReservation(t, r.stopId, row));
    } catch {
      toast.error(`Couldn't put ${r.name} back.`);
    }
  };

  const submitIdea = async () => {
    if (!selectedId) return;
    const body = ideaDraftInput(selectedId, ideaDraft);
    if (!body) return;
    const stopId = selectedId;
    try {
      const created = await tripApi.createIdea(body);
      setTrip((t) => appendIdea(t, stopId, created));
      setIdeaDraft("");
      setIdeaAddOpen(false);
    } catch {
      toast.error("Couldn't save that idea.");
    }
  };

  const doDeleteIdea = (ideaId: string) => {
    const it = selectedStop?.ideas.find((x) => x.id === ideaId);
    if (!it) return;
    if (promotingId === ideaId) setPromotingId(null);
    const undo = trip;
    setTrip(removeIdea(trip, it.stopId, ideaId));
    persist(tripApi.deleteIdea(ideaId), undo, `Couldn't delete ${it.title} — the idea is back.`);
    toast.success(`Deleted ${it.title}`, {
      duration: UNDO_WINDOW_MS,
      action: { label: "Undo", onClick: () => void restoreIdea(it) },
    });
  };

  /** Undo — with its status and note, so a "planned" idea does not come back
   * as a fresh maybe. */
  const restoreIdea = async (it: Idea) => {
    try {
      const created = await tripApi.createIdea(ideaRestoreInput(it));
      setTrip((t) => appendIdea(t, it.stopId, created));
    } catch {
      toast.error(`Couldn't put ${it.title} back.`);
    }
  };

  /**
   * "Book" — the idea becomes a reservation OF THE TYPE YOU PICKED. The server
   * used to hardcode "activity", so a promoted lunch arrived as a blue "Do".
   */
  const confirmPromote = async () => {
    const ideaId = promotingId;
    if (!ideaId || !selectedStop) return;
    const stopId = selectedStop.id;
    setPromotingId(null);
    try {
      const row = await tripApi.promoteIdea(ideaId, promoteType);
      setTrip((t) => applyPromotion(t, stopId, ideaId, row));
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
      (p) => !routes[routeCacheKey(p.from, p.to, routingHash)],
    );
    if (missing.length === 0) return;
    tripApi
      .routePairs(missing.map((p) => ({ from: p.from, to: p.to })))
      // Merge ONLY when the reply was keyed with the rig this page rendered
      // against. Edit a ROUTING field in another tab and the server keys with
      // the new hash — merging those would add keys nothing ever looks up, so
      // every later reorder would re-request the same pairs forever. A mismatch
      // means the page is stale: the estimate stands until reload.
      .then((fresh) => {
        if (fresh.routingHash !== routingHash) return;
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
            <div className="mb-2.5 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-accent">
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
            {/* The masthead has no leg in hand, so it appends to the LAST one —
                the same "goes on the end" rule every create here follows. A
                trip always has a leg: createTrip seeds "Leg 1". */}
            <button
              type="button"
              onClick={() => {
                const legId = legOrder(trip).at(-1);
                if (legId) void addStop(legId);
              }}
              disabled={trip.legs.length === 0}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-accent-deep px-4 py-[9px] text-[14px] font-semibold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
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
            actions={{
              renamingId,
              onStartRename: setRenamingId,
              onRenameDone: () => setRenamingId(null),
              onRenameLeg: doRenameLeg,
              onAddStop: (legId) => void addStop(legId),
              onAddLeg: () => void addLeg(),
              onMoveLeg: doMoveLeg,
              canMoveLeg: (legId, delta) => canMoveLeg(trip, legId, delta),
              onDeleteLeg: setDeleteLegId,
              onRenameStop: doRenameStop,
              onEditStopDates: setDatesStopId,
              onUnscheduleStop: doUnschedule,
              onMoveStopToLeg: doMoveStopToLeg,
              onDeleteStop: setDeleteStopId,
            }}
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
          leaves={{
            formTarget,
            form,
            onOpenAdd: openAddReservation,
            onOpenEdit: openEditReservation,
            onFormChange: (patch) => setForm((f) => ({ ...f, ...patch })),
            onFormCancel: () => setFormTarget(null),
            onFormSubmit: () => void submitReservationForm(),
            onDeleteReservation: doDeleteReservation,
            ideaAddOpen,
            ideaDraft,
            onToggleIdeaAdd: () => setIdeaAddOpen((v) => !v),
            onIdeaDraftChange: setIdeaDraft,
            onSubmitIdea: () => void submitIdea(),
            onDeleteIdea: doDeleteIdea,
            promotingId,
            promoteType,
            onStartPromote: (ideaId) => {
              setPromoteType("activity");
              setPromotingId(ideaId);
            },
            onPromoteTypeChange: setPromoteType,
            onCancelPromote: () => setPromotingId(null),
            onConfirmPromote: () => void confirmPromote(),
          }}
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

      <CascadeDeleteConfirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${trip.title}”?`}
        counts={tripCascadeCounts(trip)}
        action="Delete trip"
        onConfirm={deleteTrip}
      />

      {/* The two cascading deletes the route lens adds. Both count off the tree
          the client is already holding, so the sentence is real before the
          dialog opens. A reservation or an idea is a LEAF and gets no dialog
          at all — that is the undo toast in i6. */}
      {deleteLeg && (
        <CascadeDeleteConfirm
          open
          onOpenChange={(open) => !open && setDeleteLegId(null)}
          title={`Delete “${deleteLeg.title}”?`}
          counts={legCascadeCounts(deleteLeg)}
          action="Delete leg"
          onConfirm={() => doDeleteLeg(deleteLeg.id)}
        />
      )}

      {deleteStop && (
        <CascadeDeleteConfirm
          open
          onOpenChange={(open) => !open && setDeleteStopId(null)}
          title={`Delete “${deleteStop.place.name}”?`}
          counts={stopCascadeCounts(deleteStop)}
          action="Delete stop"
          onConfirm={() => doDeleteStop(deleteStop.id)}
        />
      )}

      <StopDatesDialog
        stop={datesStop}
        legName={datesStop ? (trip.legs.find((l) => l.id === datesStop.legId)?.title ?? "") : ""}
        range={{ startDate: trip.startDate, endDate: trip.endDate }}
        onOpenChange={(open) => !open && setDatesStopId(null)}
        onSave={saveStopDates}
        onUnschedule={doUnschedule}
      />
    </div>
  );
}

/** The stop the row menu's "Edit dates…" is open over. */


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
          className="cursor-pointer rounded-rv-md border-none bg-rv-accent-deep px-3.5 py-[7px] text-[12.5px] font-bold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
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
 * A cascading delete's confirm — trip, leg and stop all use THIS one, because
 * they are the same sentence with a different subject. It names the loss with
 * real counts (the client holds the whole tree) and never asks "are you
 * sure?". No destructive variant: the action is the CTA colour (ember) because
 * it is the thing you came to do, and the loss is carried by the attention
 * colour (amber). A leaf — a reservation, an idea — never reaches here.
 */
function CascadeDeleteConfirm({
  open,
  onOpenChange,
  title,
  counts,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** “Delete “Oregon Coast”?” — the question, already quoted */
  title: string;
  counts: CascadeCounts;
  /** the confirm button's verb: "Delete trip" · "Delete leg" · "Delete stop" */
  action: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[470px]">
        <AlertDialogHeader className="gap-1.5 place-items-start text-left sm:place-items-start sm:text-left">
          <AlertDialogTitle className="text-[17px] font-extrabold text-rv-ink">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-rv-warning">
            {cascadeLossSentence(counts)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mx-0 mb-0 mt-[15px] flex-row justify-start gap-[9px] border-t-0 bg-transparent p-0 sm:justify-start">
          <AlertDialogCancel className="h-auto cursor-pointer rounded-rv-md border border-rv-border-hi bg-transparent px-3.5 py-[7px] text-[12.5px] font-semibold text-rv-ink">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="h-auto cursor-pointer rounded-rv-md border-none bg-rv-accent-deep px-3.5 py-[7px] text-[12.5px] font-bold text-rv-accent-ink"
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The stop-dates dialog — the second of the epic's two dialogs, and the medium
 * weight for a stop. Native `<input type="date">`: the app ships no date
 * picker. Unschedule sits in the footer as well as in the row menu, because
 * "these dates are wrong" and "this has no dates" are the same thought here.
 *
 * Mounted only while a stop is open so the draft is re-seeded on every open —
 * that is what makes Cancel really discard (Radix keeps the component mounted
 * and only portals its content).
 */
function StopDatesDialog({
  stop,
  legName,
  range,
  onOpenChange,
  onSave,
  onUnschedule,
}: {
  stop: Stop | null;
  legName: string;
  range: TripDateRange;
  onOpenChange: (open: boolean) => void;
  onSave: (stopId: string, draft: StopDatesDraft) => void;
  onUnschedule: (stopId: string) => void;
}) {
  return (
    <Dialog open={stop !== null} onOpenChange={onOpenChange}>
      {stop && (
        <StopDatesFields
          stop={stop}
          legName={legName}
          range={range}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
          onUnschedule={onUnschedule}
        />
      )}
    </Dialog>
  );
}

function StopDatesFields({
  stop,
  legName,
  range,
  onCancel,
  onSave,
  onUnschedule,
}: {
  stop: Stop;
  legName: string;
  range: TripDateRange;
  onCancel: () => void;
  onSave: (stopId: string, draft: StopDatesDraft) => void;
  onUnschedule: (stopId: string) => void;
}) {
  const [draft, setDraft] = useState<StopDatesDraft>(() => stopDatesDraft(stop));
  const set = (patch: Partial<StopDatesDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const help = stopDatesHelp(draft);
  const patch = stopDatesPatch(stop, draft);
  // Refused, not clamped — the mirror of the trip-side rule, and of the
  // handler's own 409. deriveDays clamps to the trip window, so a stop dated
  // outside it would sit in the database and nowhere on the calendar. Said
  // here, in the server's exact sentence, before the write ever leaves.
  const outside =
    patch !== null &&
    stopDatesOutsideTrip(range, {
      arriveDate: draft.arriveDate,
      departDate: draft.departDate,
    });

  return (
    <DialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[470px]">
      <DialogHeader className="gap-1.5">
        <DialogTitle className="text-[17px] font-extrabold text-rv-ink">
          Dates for {stop.place.name}
        </DialogTitle>
        <DialogDescription className="text-[11.5px] text-rv-ink-faded">{legName}</DialogDescription>
      </DialogHeader>

      <div className="mt-3 flex flex-col gap-2.5">
        <div className="flex gap-2.5">
          <div className="flex flex-1 flex-col gap-1">
            <FieldLabel>Arrive</FieldLabel>
            <Input
              type="date"
              value={draft.arriveDate}
              onChange={(e) => set({ arriveDate: e.target.value })}
              className={FIELD_MONO}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <FieldLabel>Depart</FieldLabel>
            <Input
              type="date"
              value={draft.departDate}
              onChange={(e) => set({ departDate: e.target.value })}
              className={FIELD_MONO}
            />
          </div>
        </div>
        {help ? (
          <span className="text-[11.5px] text-rv-ink-faded">{help}</span>
        ) : (
          <p className="m-0 rounded-rv-md bg-rv-warning-soft px-[11px] py-[9px] text-[12.5px] text-rv-warning">
            Pick an arrival and a departure — the departure can’t come first.
          </p>
        )}
        {outside && (
          <p className="m-0 rounded-rv-md bg-rv-warning-soft px-[11px] py-[9px] text-[12.5px] text-rv-warning">
            {stopOutsideTripMessage(range, draft.arriveDate, draft.departDate)}
          </p>
        )}
      </div>

      <div className="mt-[15px] flex items-center gap-[9px]">
        <button
          type="button"
          onClick={() => onSave(stop.id, draft)}
          disabled={patch === null || outside}
          className="cursor-pointer rounded-rv-md border-none bg-rv-accent-deep px-3.5 py-[7px] text-[12.5px] font-bold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
        >
          Save dates
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
          onClick={() => onUnschedule(stop.id)}
          disabled={!isScheduled(stop)}
          className="ml-auto cursor-pointer rounded-rv-md border border-rv-border-hi bg-transparent px-[11px] py-[5px] text-[11.5px] font-semibold text-rv-ink disabled:cursor-default disabled:opacity-45"
        >
          Unschedule
        </button>
      </div>
    </DialogContent>
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
        active ? "dark bg-rv-navy text-rv-ink" : "bg-transparent text-rv-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}
