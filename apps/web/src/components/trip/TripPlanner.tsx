"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  CascadeCounts,
  Idea,
  IdeaCategory,
  PickedPlace,
  SavedPlace,
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
  ideaIsLocated,
  ideaPlace,
  ideaRestoreInput,
  isScheduled,
  LOCATE_MAX_ROWS,
  nearOf,
  locateToastMessage,
  legCascadeCounts,
  nextLegTitle,
  drivePairs,
  withReconciledSegments,
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
  stopPlaceCreate,
  stopPlacePatch,
  stopsOutsideRange,
  tripCascadeCounts,
  tripDayCount,
  tripSettingsDraft,
  tripSettingsPatch,
  unscheduleStopPatch,
} from "@rv-trip/core";
import { CategoryTile, FieldLabel, Stars, ideaCategoryMeta, ideaCategoryOfType } from "@rv-trip/ui";
import {
  Binoculars,
  Compass,
  House,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Library,
  MapPin,
  MapPinX,
  Route,
  ChartNoAxesGantt,
  Plus,
  Settings,
  Tent,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import {
  allStops,
  appendIdea,
  appendShelfIdea,
  appendLeg,
  appendReservation,
  appendStop,
  applyPromotion,
  canMoveLeg,
  legOrder,
  moveLeg,
  moveStopToLeg,
  attachIdeaToStop,
  detachIdeaToShelf,
  ideaShelf,
  planIdeaOnGap,
  removeIdea,
  removeShelfIdea,
  setShelfIdeaFields,
  removeLeg,
  removeReservation,
  removeStop,
  renameLeg,
  renameStop,
  setStopDates,
  setStopPlace,
  stopAbove,
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
  setIdeaPlace,
  setIdeaRating,
  setIdeaNote,
  scheduleFloating,
  reorderFloating,
  type NavMap,
  type RouteMap,
  type ShelfFilter,
  type TimelineGap,
} from "@/lib/trip-logic";
import type { LatLng, Units } from "@rv-trip/core";
import { tripApi } from "@/lib/trip-api";
import { fullRange, monthDay } from "@/lib/trip-ui";
import { useBooleanPref } from "@/lib/pref";
import { PrefSwitch } from "@/components/ui/pref-switch";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MENU_ITEM, MENU_ITEM_WARN, MENU_SURFACE, MenuHint, RowMenu } from "./row-menu";
import { Timeline } from "./Timeline";
import { PlacePicker } from "@/components/places/PlacePicker";
import { RouteView } from "./RouteView";
import { StopDetailSheet } from "./StopDetailSheet";


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
  nav = {},
  hasRig,
  units,
  savedPlaces = [],
}: {
  trip: Trip;
  /** Server-resolved drives, keyed `from|to|routingHash`. */
  routes: RouteMap;
  routingHash: string;
  /**
   * Server-resolved corridor verdicts, keyed the same way. Defaulted, because
   * resolving it is billable and opt-in: a caller that did not ask for it
   * renders every drive's Navigate as the shipped "plain" control.
   *
   * Held in props, NOT in state beside `routes`: the drag-reorder upgrade path
   * (`POST /api/routes`) re-resolves routes only, so a pair invented by
   * dragging stays honestly unchecked until the next full load.
   */
  nav?: NavMap;
  hasRig: boolean;
  /** The account's display units, resolved on the server (trips/[id]/page.tsx).
   * It reaches two places: every drive row's label, worded by core's
   * `driveLabel` inside `routeModel`, and the rail's 34px hero. */
  units: Units;
  /**
   * The account's Places library, read on the SAME server seam as the trip
   * (trips/[id]/page.tsx) — the "Add from Places" entrance (#80 Q6 → A).
   * Defaulted, so a caller that has no library in hand renders the panel empty
   * rather than failing to render at all.
   */
  savedPlaces?: SavedPlace[];
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
  /** The leg whose "Add stop" DRAFT row is open. The draft is not a stop — the
   * pick is the create — so dismissing it writes nothing, which is how this
   * screen stops manufacturing the coordless rows #60 exists to repair. */
  const [draftLegId, setDraftLegId] = useState<string | null>(null);
  /** The stop whose place editor is open. One editor, three entry points: the
   * row menu, the row's amber coordless chip, and the stop sheet's mini-map. */
  const [placingStopId, setPlacingStopId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  /** The optional place on the stop sheet's "Add idea" form. */
  const [ideaPicked, setIdeaPicked] = useState<PickedPlace | null>(null);
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
  /** The shelf's pressed proximity chip (#80). `all` is the reset. */
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>({ kind: "all" });
  /** The "+ Add" branch that is open, as the kind of maybe it creates. `null`
   * is closed; the fourth branch ("A stop") is the shipped draft-stop row. */
  const [addIdeaCategory, setAddIdeaCategory] = useState<IdeaCategory | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [shelfDraft, setShelfDraft] = useState("");
  const [shelfPicked, setShelfPicked] = useState<PickedPlace | null>(null);
  /** The Add-from-Places panel — the library, filtered, one Add per row. */
  const [placesPanelOpen, setPlacesPanelOpen] = useState(false);
  /** The shelf row whose place picker is open — the same #69 entrance the stop
   * sheet's idea card has, on the rail's card. */
  const [locatingShelfIdeaId, setLocatingShelfIdeaId] = useState<string | null>(null);
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
  // The rail's first section. Pure, memoized on the trip and the pressed chip
  // — the proximity pairs are ideas × located stops, so this stays bounded.
  const shelf = useMemo(() => ideaShelf(trip, shelfFilter), [trip, shelfFilter]);
  const route = useMemo(
    () => routeModel(trip, routes, routingHash, nav, units),
    [trip, routes, routingHash, nav, units],
  );
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
    setIdeaPicked(null);
    setPromotingId(null);
  };
  const openStop = (id: string) => {
    setSelectedId(id);
    resetLeafForms();
  };
  const closeStop = () => {
    setSelectedId(null);
    // Mount B's editor cannot outlive the sheet it was opened from — it would
    // reappear, still open, on the row behind it.
    setPlacingStopId(null);
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

  // ── the idea shelf (#80) ─────────────────────────────────────────────────
  //
  // Four writes, all through the same persist()/undo path every other gesture
  // here uses. The three DROPS have no dialog in front of them, so the toast is
  // where each becomes reversible — the contract `doSchedule` above already
  // holds.

  /** One branch of "+ Add" opens the draft; opening it closes the other two
   * surfaces a maybe can be created from. */
  const openAddIdea = (category: IdeaCategory) => {
    setDraftLegId(null);
    setPlacesPanelOpen(false);
    setShelfDraft("");
    setShelfPicked(null);
    setAddIdeaCategory(category);
  };

  /** The shelf's "+ Add" — one field plus an optional place, exactly like the
   * sheet's, but with no stop in hand. */
  const submitShelfIdea = async () => {
    if (!addIdeaCategory) return;
    const body = ideaDraftInput(
      { tripId: trip.id, stopId: null, category: addIdeaCategory },
      shelfDraft,
      shelfPicked,
    );
    if (!body) return;
    try {
      const created = await tripApi.createIdea(body);
      setTrip((t) => appendShelfIdea(t, created));
      setShelfDraft("");
      setShelfPicked(null);
      setAddIdeaCategory(null);
    } catch {
      toast.error("Couldn't save that idea.");
    }
  };

  /**
   * "Add from Places" — the library row is COPIED into a trip idea (Q6 → A).
   * One direction of travel: name, coordinates, the Google place id, the type
   * as a category and the source note all come across, and NO `savedPlaceId`
   * goes back — a link would re-create the dual-write the answer rejects, and
   * the copy is yours to edit without touching the library.
   */
  const addIdeaFromPlace = async (p: SavedPlace) => {
    try {
      const created = await tripApi.createIdea({
        tripId: trip.id,
        stopId: null,
        category: ideaCategoryOfType(p.type),
        title: p.place.name,
        status: "idea",
        // The Google id travels on every path that learns a place (#80 Q7
        // comment) — `place` carries all four columns together.
        place: p.place,
        rating: null,
        notes: p.source,
      });
      setTrip((t) => appendShelfIdea(t, created));
      toast.success(`Added ${p.place.name} to this trip's ideas`);
    } catch {
      toast.error(`Couldn't add ${p.place.name}.`);
    }
  };

  /**
   * Gesture 1 · a STAY-idea dropped on open days.
   *
   * It creates the stop immediately (Q3 → A) and links the idea to it: two
   * writes, one gesture. The dates are `planIdeaOnGap` — the SAME rule
   * `scheduleFloating` uses, so a drop on the Oct 18–24 span lands Oct 18–20 for
   * an idea exactly as it does for a floating stop. The leg is the one owning
   * the last stop, falling back to the last leg: the "goes on the end" rule
   * every create here already follows.
   */
  const doPlanIdea = async (ideaId: string, gap: TimelineGap) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    if (!it) return;
    const dates = planIdeaOnGap(trip, gap);
    if (!dates) return;
    const legId = legOrder(trip).at(-1);
    if (!legId) return;
    const undo = trip;
    try {
      const created = await tripApi.createStop({
        legId,
        place: it.place ?? { name: it.title, lat: null, lng: null, googlePlaceId: null },
        arriveDate: dates.arriveDate,
        departDate: dates.departDate,
      });
      const next = attachIdeaToStop(appendStop(trip, created), ideaId, created.id);
      setTrip(next);
      upgradeRoutes(next);
      // Held, not just fired: Undo chains off it so the detach below can never
      // overtake the attach on the wire.
      const attached = persist(
        tripApi.updateIdea(ideaId, { stopId: created.id, status: "planned" }),
        undo,
        `Couldn't plan ${it.title} — it's back on the shelf.`,
      );
      toast.success(
        `Planned ${it.title} · ${monthDay(dates.arriveDate)} – ${monthDay(dates.departDate)}`,
        {
          action: {
            label: "Undo",
            onClick: () => {
              setTrip(undo);
              // DETACH FIRST, then delete. `ideas.stop_id` is ON DELETE CASCADE
              // (packages/db/src/schema.ts:133), so deleting the stop this
              // gesture created while the idea is still attached DESTROYS the
              // idea — the rail would show it back for one session and it
              // would be gone on the next load. The PATCH puts the row (and the
              // status the plan moved to "planned") back where the undone tree
              // already shows it; only then is the stop safe to remove.
              void attached
                .then(() => tripApi.updateIdea(ideaId, { stopId: null, status: it.status }))
                .then(() => tripApi.deleteStop(created.id))
                .catch(() => {
                  toast.error(`Couldn't undo — ${it.title} still has dates.`);
                });
            },
          },
        },
      );
    } catch {
      toast.error(`Couldn't plan ${it.title} — nothing was created.`);
    }
  };

  /** Gesture 2 · a DO/EAT idea dropped on a stop bar. It leaves the shelf and
   * appears under that stop. Status is untouched: attaching is not planning. */
  const doAttachIdea = (ideaId: string, stopId: string) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    const stop = byId.get(stopId);
    if (!it || !stop) return;
    const undo = trip;
    setTrip(attachIdeaToStop(trip, ideaId, stopId));
    persist(
      tripApi.updateIdea(ideaId, { stopId }),
      undo,
      `Couldn't move ${it.title} — it's back on the shelf.`,
    );
    toast.success(`${it.title} → ${stop.place.name}`, {
      action: {
        label: "Undo",
        onClick: () => doDetachIdea(ideaId),
      },
    });
  };

  /** Gesture 3 · an ATTACHED idea goes back to the shelf. Legal only now that
   * `stop_id` is nullable, and it is an EXPLICIT null on the wire — absent
   * would mean "leave the attachment alone". */
  const doDetachIdea = (ideaId: string) => {
    const it = allStops(trip)
      .flatMap((st) => st.ideas)
      .find((x) => x.id === ideaId);
    if (!it) return;
    const undo = trip;
    setTrip(detachIdeaToShelf(trip, ideaId));
    persist(
      tripApi.updateIdea(ideaId, { stopId: null }),
      undo,
      `Couldn't move ${it.title} — it's back under its stop.`,
    );
  };

  /** The shelf card's own leaf writes: the status pill and the delete. They go
   * through the SAME endpoints the sheet's card uses — #80's whole ownership
   * move is what makes them reach a row with a null stop_id at all. */
  const cycleShelfIdeaStatus = (ideaId: string) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    if (!it) return;
    const order: Idea["status"][] = ["idea", "planned", "done"];
    const status = order[(order.indexOf(it.status) + 1) % 3]!;
    const undo = trip;
    setTrip(setShelfIdeaFields(trip, ideaId, { status }));
    persist(
      tripApi.updateIdea(ideaId, { status }),
      undo,
      `Couldn't change ${it.title} — put back the way it was.`,
    );
  };

  /**
   * The shelf row's RESEARCH PAD (#82) — its stars and its note.
   *
   * TWO NEW handlers, not a re-thread of the stop sheet's three. Those are
   * stop-scoped by construction: `setIdeaRating(trip, selectedStop.id, …)` and
   * `setIdeaNote(…)` both walk into a stop's `ideas`, and an unattached idea is
   * not in any stop's — it lives in `trip.ideas`. So the shelf's pad writes
   * through `setShelfIdeaFields`, the same pure mutation the pill and Locate
   * already use. The PATCH is unchanged: `ideaPatchInput` has carried `rating`
   * and `notes` all along.
   */
  const setShelfIdeaRating = (ideaId: string, n: number) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    if (!it) return;
    // Stars toggle-to-clear hands back 0; the column is nullable, not zero.
    const rating = n === 0 ? null : n;
    const undo = trip;
    setTrip(setShelfIdeaFields(trip, ideaId, { rating }));
    persist(
      tripApi.updateIdea(ideaId, { rating }),
      undo,
      "Couldn't save that rating — the old rating is back.",
    );
  };

  /** Keystrokes only — optimistic, coalesced into ONE undo by `beginNoteEdit`,
   * exactly as the sheet's note does. The write happens on blur. */
  const setShelfIdeaNote = (ideaId: string, v: string) => {
    beginNoteEdit();
    setTrip((t) => setShelfIdeaFields(t, ideaId, { notes: v }));
  };

  const commitShelfIdeaNote = (ideaId: string) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    persist(
      tripApi.updateIdea(ideaId, { notes: it?.notes ?? "" }),
      takeNoteUndo(),
      "Couldn't save that note — the old note is back.",
    );
  };

  /** The shelf row's Locate — the picker's choice, straight through the shipped
   * `PATCH { place }`. `ideaPlace` is the same PickedPlace → Place mapper the
   * sheet's card uses, so the free-text escape row stays a legal pick and the
   * Google id travels whenever there is one (#80 Q7 comment). */
  const doLocateShelfIdea = (ideaId: string, picked: PickedPlace) => {
    const place = ideaPlace(picked);
    const undo = trip;
    setTrip(setShelfIdeaFields(trip, ideaId, { place }));
    persist(
      tripApi.updateIdea(ideaId, { place }),
      undo,
      "Couldn't save that place — the idea is back the way it was.",
    );
  };

  /**
   * #74 · the shelf row's "Clear place" — the door onto the `place: null`
   * clear #69 shipped and tested but left unpressable.
   *
   * An EXPLICIT null on the wire: `ideaPatchColumns` reads an absent `place` as
   * "say nothing about the place", and only a real null erases the four
   * columns. The menu that fires this renders in place-state 3 only, so there
   * is always something to clear; a failure puts the place back through
   * `persist`, which is the whole undo this gesture gets — the frame's hint is
   * "→ no place", not "undo", because clearing hands the row its own Locate
   * button straight back.
   */
  const doClearShelfIdeaPlace = (ideaId: string) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    if (!it) return;
    const undo = trip;
    setTrip(setShelfIdeaFields(trip, ideaId, { place: null }));
    persist(
      tripApi.updateIdea(ideaId, { place: null }),
      undo,
      `Couldn't clear the place on ${it.title} — put back the way it was.`,
    );
  };

  const doDeleteShelfIdea = (ideaId: string) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    if (!it) return;
    const undo = trip;
    setTrip(removeShelfIdea(trip, ideaId));
    persist(tripApi.deleteIdea(ideaId), undo, `Couldn't delete ${it.title} — the idea is back.`);
    toast.success(`Deleted ${it.title}`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          void tripApi
            .createIdea(ideaRestoreInput(it))
            .then((created) => setTrip((t) => appendShelfIdea(t, created)))
            .catch(() => toast.error(`Couldn't put ${it.title} back.`));
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

  /**
   * "Add stop" no longer creates anything: it appends a DRAFT row to the leg
   * and opens the picker inside it, biased to the stop above. Nothing is
   * written until a place is chosen — which is the whole of #60's headline fix,
   * because the old path posted a literal "New stop" with three null columns
   * that no patch could ever repair.
   */
  const openDraftStop = (legId: string) => {
    setLens("route");
    setPlacingStopId(null);
    setDraftLegId(legId);
  };

  /** The pick IS the create: name, coordinates and place id in one write, so
   * the stop is born mapped and its connector resolves immediately. */
  const createStopFromPick = async (legId: string, picked: PickedPlace) => {
    const body = stopPlaceCreate(legId, picked);
    if (!body) return;
    setDraftLegId(null);
    try {
      const created = await tripApi.createStop(body);
      const next = appendStop(trip, created);
      setTrip(next);
      upgradeRoutes(next);
    } catch {
      toast.error("Couldn't add a stop — nothing was created.");
    }
  };

  /**
   * "Change place…" / "Set place" — the whole place at once, which is the one
   * thing the rename can never do. The place REPLACES the old one, so a
   * re-picked free-text name honestly clears the coordinates rather than
   * leaving a pin at the last spot under a new label.
   */
  const doChangeStopPlace = (stopId: string, picked: PickedPlace) => {
    const patch = stopPlacePatch(picked);
    if (!patch?.place) return;
    setPlacingStopId(null);
    const undo = trip;
    const was = byId.get(stopId)?.place.name ?? "that stop";
    const next = setStopPlace(trip, stopId, patch.place);
    setTrip(next);
    upgradeRoutes(next);
    persist(
      tripApi.updateStop(stopId, patch),
      undo,
      `Couldn't change the place for ${was} — the old one is back.`,
    );
  };

  /**
   * The rail's Locate — the same bounded batch /map already ships, pointed at
   * the planner's coordless STOPS (`locateRowKind` has always been
   * `["place","stop"]`).
   *
   * It refreshes rather than echoing: `LocateResponse` returns only id/lat/lng,
   * not the `googlePlaceId` the server also wrote, so a local echo would leave
   * the client's place id permanently stale — and the drives have to be
   * re-resolved server-side anyway.
   */
  const locateUnmapped = () => {
    const batch = summary.unmappedStops.slice(0, LOCATE_MAX_ROWS);
    if (batch.length === 0) return;
    setLocating(true);
    tripApi
      .locatePlaces(batch.map((row) => ({ kind: "stop" as const, id: row.id })))
      .then(({ located, results }) => {
        const found = new Set(results.map((r) => r.id));
        const stuck = batch.filter((row) => !found.has(row.id)).map((row) => row.name);
        toast.success(locateToastMessage(located, stuck));
        router.refresh();
      })
      .catch(() => toast.error("Locate didn't run — check your connection."))
      .finally(() => setLocating(false));
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
    // A home base set or cleared adds or drops the home → first hop; the server
    // reconciles in the same write, so the optimistic trip does too (#110 §6).
    setTrip(withReconciledSegments({ ...trip, ...patch }));
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
    if (!r || !selectedStop) return;
    const patch = reservationDraftPatch(r, form);
    if (patch === null) return;
    setFormTarget(null);
    if (Object.keys(patch).length === 0) return;
    const undo = trip;
    // The sheet lists only its stop's reservations (#110 Q2 A), so the row's
    // parent IS the open stop.
    setTrip(setReservationFields(trip, selectedStop.id, r.id, patch));
    persist(
      tripApi.updateReservation(r.id, patch),
      undo,
      `Couldn't save ${r.name} — your changes are back as they were.`,
    );
  };

  const doDeleteReservation = (resId: string) => {
    const r = selectedStop?.reservations.find((x) => x.id === resId);
    if (!r || !selectedStop) return;
    if (formTarget === resId) setFormTarget(null);
    const undo = trip;
    const next = removeReservation(trip, selectedStop.id, resId);
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
      // The re-POSTed row is stop-attached by construction.
      setTrip((t) => (row.stopId ? appendReservation(t, row.stopId, row) : t));
    } catch {
      toast.error(`Couldn't put ${r.name} back.`);
    }
  };

  const submitIdea = async () => {
    if (!selectedId) return;
    // The place is optional and the title is not: a place without a title is
    // not an idea, which is exactly what `ideaDraftInput` refuses.
    // The sheet's form always has a stop in hand; the shelf's "+ Add" is the
    // one with none (#80).
    const body = ideaDraftInput(
      { tripId: trip.id, stopId: selectedId },
      ideaDraft,
      ideaPicked,
    );
    if (!body) return;
    const stopId = selectedId;
    try {
      const created = await tripApi.createIdea(body);
      setTrip((t) => appendIdea(t, stopId, created));
      setIdeaDraft("");
      setIdeaPicked(null);
      setIdeaAddOpen(false);
    } catch {
      toast.error("Couldn't save that idea.");
    }
  };

  const doDeleteIdea = (ideaId: string) => {
    const it = selectedStop?.ideas.find((x) => x.id === ideaId);
    if (!it || it.stopId === null) return;
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
      // An undone delete puts the row back where it WAS — a shelf idea comes
      // back as a shelf idea, not as a fresh maybe under a stop.
      setTrip((t) =>
        created.stopId === null
          ? appendShelfIdea(t, created)
          : appendIdea(t, created.stopId, created),
      );
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
    // Driven hops only (#110 §6): a flight has no road to fetch.
    const missing = drivePairs(next).filter(
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
      <div className="mx-auto max-w-[1240px] px-4 py-6 md:px-6 md:py-8">
        {/* Masthead */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="mb-2.5 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-accent">
              <Compass className="size-3.5" />
              <span>RV Trip Hub · Trip Planner</span>
            </div>
            <h1 className="m-0 mb-2.5 text-[28px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink md:text-[44px]">
              <InlineText
                value={trip.title}
                onSave={renameTrip}
                label="Rename trip"
                className="text-[28px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink md:text-[44px]"
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

          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
            <div className="inline-flex flex-1 rounded-rv-pill border border-rv-border bg-rv-surface p-[3px] md:flex-none">
              <ToggleTab active={lens === "route"} onClick={() => setLens("route")}>
                <Route className="size-4" />
                Route
              </ToggleTab>
              <ToggleTab active={lens === "timeline"} onClick={() => setLens("timeline")}>
                <ChartNoAxesGantt className="size-4" />
                Timeline
              </ToggleTab>
            </div>
            <PrefSwitch checked={costTracking} onChange={changeCostTracking} label="Track costs" />
            {/* ONE add verb that BRANCHES (#80 Q5 → C). The masthead used to
                offer "Add stop" and nothing else, which made a stop the only
                thing you could put on a trip; a maybe is the earlier thought,
                so the three idea kinds come first and the stop is the fourth
                item. It still has no leg in hand, so a stop appends to the LAST
                one — the same "goes on the end" rule every create here follows.
                A trip always has a leg: createTrip seeds "Leg 1". */}
            <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
              <DropdownMenuTrigger
                disabled={trip.legs.length === 0}
                className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-accent-deep px-4 py-[9px] text-[14px] font-semibold text-rv-accent-ink disabled:cursor-default disabled:opacity-45 md:ml-0"
              >
                <Plus className="size-4" />
                Add
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={MENU_SURFACE}>
                <DropdownMenuItem className={MENU_ITEM} onSelect={() => openAddIdea("do")}>
                  <Binoculars />
                  Something to do
                  <MenuHint>idea</MenuHint>
                </DropdownMenuItem>
                <DropdownMenuItem className={MENU_ITEM} onSelect={() => openAddIdea("eat")}>
                  <Utensils />
                  Somewhere to eat
                  <MenuHint>idea</MenuHint>
                </DropdownMenuItem>
                <DropdownMenuItem className={MENU_ITEM} onSelect={() => openAddIdea("stay")}>
                  <Tent />
                  Somewhere to stay
                  <MenuHint>idea</MenuHint>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={MENU_ITEM}
                  onSelect={() => {
                    const legId = legOrder(trip).at(-1);
                    if (legId) openDraftStop(legId);
                  }}
                >
                  <MapPin />
                  A stop
                  <MenuHint>on the plan</MenuHint>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* The shelf's "+ Add" draft and the Add-from-Places panel both open
            ABOVE the two lenses: a maybe belongs to the trip, not to a lens. */}
        {addIdeaCategory && (
          <ShelfIdeaDraft
            category={addIdeaCategory}
            title={shelfDraft}
            picked={shelfPicked}
            near={nearOf(allStops(trip).at(-1)?.place, trip.homeBasePlace)}
            onTitle={setShelfDraft}
            onPicked={setShelfPicked}
            onSave={() => void submitShelfIdea()}
            onCancel={() => {
              setAddIdeaCategory(null);
              setShelfDraft("");
              setShelfPicked(null);
            }}
          />
        )}
        {placesPanelOpen && (
          <AddFromPlacesPanel
            places={savedPlaces}
            onAdd={(p) => void addIdeaFromPlace(p)}
            onClose={() => setPlacesPanelOpen(false)}
          />
        )}

        {lens === "timeline" ? (
          <Timeline
            model={timeline}
            shelf={shelf}
            shelfFilter={shelfFilter}
            onShelfFilter={setShelfFilter}
            onOpenStop={openStop}
            onCycleIdea={cycleShelfIdeaStatus}
            onLocateIdea={(id) => setLocatingShelfIdeaId(id)}
            onRateIdea={setShelfIdeaRating}
            onNoteIdea={setShelfIdeaNote}
            onCommitIdeaNote={commitShelfIdeaNote}
            ideaPicker={(it) =>
              locatingShelfIdeaId === it.id ? (
                <PlacePicker
                  value={null}
                  onChange={(picked) => {
                    setLocatingShelfIdeaId(null);
                    if (picked) doLocateShelfIdea(it.id, picked);
                  }}
                  near={nearOf(allStops(trip).at(-1)?.place, trip.homeBasePlace)}
                />
              ) : undefined
            }
            onSchedule={doSchedule}
            onPlanIdea={(ideaId, gap) => void doPlanIdea(ideaId, gap)}
            onAttachIdea={doAttachIdea}
            onAddFromPlaces={() => setPlacesPanelOpen((v) => !v)}
            ideaActions={(it) => (
              <RowMenu label={`Actions for ${it.title}`}>
                {/* #74 · place-state 3 only. A coordless or place-less shelf
                    row keeps its Locate button, so neither item renders for
                    it — `ideaIsLocated` is the one derivation behind the row's
                    place line and both of these doors. */}
                {ideaIsLocated(it) && (
                  <>
                    <DropdownMenuItem
                      className={MENU_ITEM}
                      onSelect={() => setLocatingShelfIdeaId(it.id)}
                    >
                      <MapPin />
                      Change place
                      <MenuHint>picker</MenuHint>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className={MENU_ITEM_WARN}
                      onSelect={() => doClearShelfIdeaPlace(it.id)}
                    >
                      <MapPinX />
                      Clear place
                      <MenuHint>→ no place</MenuHint>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  className={MENU_ITEM_WARN}
                  onSelect={() => doDeleteShelfIdea(it.id)}
                >
                  <Trash2 />
                  Delete
                  <MenuHint>undo</MenuHint>
                </DropdownMenuItem>
              </RowMenu>
            )}
          />
        ) : (
          <RouteView
            legs={route}
            summary={summary}
            homeBasePlace={trip.homeBasePlace}
            costs={costTracking}
            hasRig={hasRig}
            units={units}
            onOpenStop={openStop}
            routeDrag={routeDrag}
            actions={{
              renamingId,
              // Renaming and changing the place are two editors for one row;
              // opening either closes the other.
              onStartRename: (id) => {
                setPlacingStopId(null);
                setRenamingId(id);
              },
              onRenameDone: () => setRenamingId(null),
              onRenameLeg: doRenameLeg,
              onAddStop: openDraftStop,
              onAddLeg: () => void addLeg(),
              onMoveLeg: doMoveLeg,
              canMoveLeg: (legId, delta) => canMoveLeg(trip, legId, delta),
              onDeleteLeg: setDeleteLegId,
              onRenameStop: doRenameStop,
              onEditStopDates: setDatesStopId,
              onUnscheduleStop: doUnschedule,
              onMoveStopToLeg: doMoveStopToLeg,
              onDeleteStop: setDeleteStopId,
              draftLegId,
              onPickDraftStop: (legId, picked) => void createStopFromPick(legId, picked),
              onCancelDraftStop: () => setDraftLegId(null),
              placingStopId,
              onStartChangePlace: (stopId) => {
                setDraftLegId(null);
                setRenamingId(null);
                setPlacingStopId(stopId);
              },
              onChangeStopPlace: doChangeStopPlace,
              onCancelChangePlace: () => setPlacingStopId(null),
              locating,
              onLocate: locateUnmapped,
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
            ideaPicked,
            onIdeaPickedChange: setIdeaPicked,
            onToggleIdeaAdd: () => {
              setIdeaPicked(null);
              setIdeaAddOpen((v) => !v);
            },
            onIdeaDraftChange: setIdeaDraft,
            onSubmitIdea: () => void submitIdea(),
            onDeleteIdea: doDeleteIdea,
            onDetachIdea: doDetachIdea,
            onLocateIdea: (ideaId, picked) => {
              // The row's Locate does not geocode — the human already chose, so
              // the picked place is written straight through the idea PATCH.
              // `ideaPlace` is the same PickedPlace → Place mapper the Add-idea
              // form uses, so the two entrances write identical rows.
              const undo = trip;
              const place = ideaPlace(picked);
              setTrip(setIdeaPlace(trip, selectedStop.id, ideaId, place));
              persist(
                tripApi.updateIdea(ideaId, { place }),
                undo,
                "Couldn't save that place — put back the way it was.",
              );
            },
            onClearIdeaPlace: (ideaId) => {
              // #74 · the ATTACHED idea's clear. Same explicit null, same
              // endpoint and same optimistic-then-persist shape as the shelf's
              // (`doClearShelfIdeaPlace`); only the tree write differs, because
              // this row lives under a stop.
              const undo = trip;
              setTrip(setIdeaPlace(trip, selectedStop.id, ideaId, null));
              persist(
                tripApi.updateIdea(ideaId, { place: null }),
                undo,
                "Couldn't clear that place — put back the way it was.",
              );
            },
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
          placing={placingStopId === selectedStop.id}
          placeNear={nearOf(stopAbove(trip, selectedStop.id)?.place, trip.homeBasePlace)}
          onStartChangePlace={() => setPlacingStopId(selectedStop.id)}
          onChangePlace={(picked) => doChangeStopPlace(selectedStop.id, picked)}
          onCancelChangePlace={() => setPlacingStopId(null)}
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

/** A dialog field's chrome — the app's one input skin, in the dialog's palette.
 * Only the mono (date) variant survives #60: home base is the picker now, and
 * the picker brings its own. */
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
          {/* The same picker, unstyled by this dialog: the rv-* names re-resolve
              under the dialog's own `.dark`, exactly as its Inputs already do. */}
          <PlacePicker
            value={draft.homeBasePlace}
            onChange={(homeBasePlace) => set({ homeBasePlace })}
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

/**
 * The shelf's "+ Add" draft — one field plus the OPTIONAL place picker, the
 * same two-part form the stop sheet's "Add idea" already is.
 *
 * It is a draft, not an idea: dismissing it writes nothing, exactly the way the
 * draft-stop row works (#60). The heading says which of the three branches you
 * pressed, so a menu choice is still legible once the menu is gone.
 */
function ShelfIdeaDraft({
  category,
  title,
  picked,
  near,
  onTitle,
  onPicked,
  onSave,
  onCancel,
}: {
  category: IdeaCategory;
  title: string;
  picked: PickedPlace | null;
  near: LatLng | null;
  onTitle: (v: string) => void;
  onPicked: (p: PickedPlace | null) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const cm = ideaCategoryMeta(category);
  const heading =
    category === "stay"
      ? "Somewhere to stay"
      : category === "eat"
        ? "Somewhere to eat"
        : "Something to do";
  return (
    <div className="mb-5 flex flex-col gap-2.5 rounded-rv-card border border-dashed border-rv-border-hi bg-rv-surface p-4 shadow-rv-sm">
      <div className="flex items-center gap-2">
        <cm.Icon className="size-[18px]" style={{ color: cm.color }} />
        <span className="text-[14px] font-bold text-rv-ink">{heading}</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Discard this idea"
          className="ml-auto inline-flex size-6 cursor-pointer items-center justify-center rounded-rv-sm border border-rv-border bg-transparent text-rv-ink-faded"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <label className="flex flex-col gap-1">
        <FieldLabel>Idea</FieldLabel>
        <Input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="e.g. Coachland RV Park"
        />
      </label>
      <div className="flex flex-col gap-1">
        <FieldLabel>
          Place{" "}
          <span className="font-sans font-normal normal-case tracking-normal text-rv-ink-faded">
            optional
          </span>
        </FieldLabel>
        <PlacePicker value={picked} onChange={onPicked} near={near} />
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={title.trim() === ""}
        className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-rv-md border-none bg-rv-accent-deep px-4 py-2 text-[13px] font-semibold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
      >
        <Plus className="size-4" />
        Add to ideas
      </button>
    </div>
  );
}

/**
 * "Add from Places" (#80 Q6 → A) — the account's library, opened from the
 * shelf head.
 *
 * Picking COPIES: one direction of travel, no dual-write, and the copy is yours
 * to edit without touching the library. The library itself is a server prop
 * (trips/[id]/page.tsx), so opening this panel costs no round-trip.
 */
function AddFromPlacesPanel({
  places,
  onAdd,
  onClose,
}: {
  places: SavedPlace[];
  onAdd: (p: SavedPlace) => void;
  onClose: () => void;
}) {
  const want = places.filter((p) => p.status === "want");
  return (
    <div className="mb-5 rounded-rv-card border border-rv-border bg-rv-surface p-4 shadow-rv-sm">
      <div className="mb-3 flex items-center gap-2">
        <Library className="size-[18px] text-rv-ink" />
        <span className="text-[14px] font-bold text-rv-ink">From your Places</span>
        <span className="font-mono text-[10.5px] text-rv-ink-faded">{want.length} saved</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close your Places"
          className="ml-auto inline-flex size-6 cursor-pointer items-center justify-center rounded-rv-sm border border-rv-border bg-transparent text-rv-ink-faded"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {want.length === 0 ? (
        <p className="m-0 text-[13px] text-rv-ink-muted">
          Nothing on the want shelf yet — save a place from /places and it shows up here.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {want.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-rv-md border border-rv-border-soft bg-rv-surface-alt px-2.5 py-2"
            >
              <CategoryTile type={p.type} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-rv-ink">{p.place.name}</div>
                <div className="truncate font-mono text-[10.5px] text-rv-ink-faded">
                  {[p.region, p.source && `“${p.source}”`].filter(Boolean).join(" · ") || " "}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onAdd(p)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-rv-md border border-rv-green bg-rv-green-soft px-2.5 py-1 text-[12px] font-semibold text-rv-green-ink"
              >
                <Plus className="size-3.5" />
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
