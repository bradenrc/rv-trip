"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  CascadeCounts,
  ForNextTime,
  Idea,
  IdeaCategory,
  NearbySave,
  NearbySaves,
  NextTimeRow,
  PickedPlace,
  SavedPlace,
  SurfaceRadiusMi,
  Reservation,
  ReservationCreateInput,
  ReservationDraft,
  ReservationType,
  TravelMode,
  Destination,
  DestinationDatesDraft,
  Trip,
  TripDateRange,
  TripSettingsDraft,
  BoundaryFlightsBody,
  DateSpan,
  Place,
  ReservationPatchInput,
  SegmentBookingsChoice,
} from "@rv-trip/core";
import {
  UNDO_WINDOW_MS,
  markRowOnShelf,
  nextTimeIdeaBody,
  applyHopBooking,
  removeSegmentBooking,
  setSegmentMode,
  stayDraft,
  cascadeLossSentence,
  ideaDraftInput,
  ideaIsLocated,
  ideaPlace,
  ideaRestoreInput,
  isScheduled,
  LOCATE_MAX_ROWS,
  searchAnchor,
  resolveHomeBase,
  editSegmentBooking,
  locateToastMessage,
  chapterCascadeCounts,
  drivePairs,
  withReconciledSegments,
  orphanedDestinationsMessage,
  reservationDraft,
  reservationDraftInput,
  reservationDraftPatch,
  reservationRestoreInput,
  routeCacheKey,
  destinationCascadeCounts,
  destinationDatesDraft,
  destinationDatesOutsideTrip,
  destinationDatesHelp,
  destinationDatesPatch,
  destinationOutsideTripMessage,
  destinationPlaceCreate,
  destinationPlacePatch,
  destinationsOutsideRange,
  tripCascadeCounts,
  tripDayCount,
  tripSettingsDraft,
  tripSettingsPatch,
  unscheduleDestinationPatch,
} from "@rv-trip/core";
import {
  CategoryTile,
  FieldLabel,
  RangePicker,
  SegmentedControl,
  Stars,
  ideaCategoryMeta,
  ideaCategoryOfType,
} from "@rv-trip/ui";
import {
  Binoculars,
  BookOpen,
  Compass,
  House,
  Bed,
  Lightbulb,
  Plane,
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
  allDestinations,
  appendIdea,
  appendShelfIdea,
  appendChapter,
  appendReservation,
  appendDestination,
  applyPromotion,
  canMoveChapter,
  chapterOrder,
  moveChapter,
  moveDestinationToChapter,
  attachIdeaToDestination,
  detachIdeaToShelf,
  ideaShelf,
  removeIdea,
  removeShelfIdea,
  setShelfIdeaFields,
  removeChapter,
  removeReservation,
  removeDestination,
  renameChapter,
  renameDestination,
  setDestinationDates,
  setDestinationPlace,
  destinationAbove,
  timelineModel,
  routeModel,
  routeSummary,
  routeCountKicker,
  logisticsModel,
  destinationMap,
  setDestinationRating,
  setDestinationNote,
  setReservationRating,
  setReservationNote,
  setReservationFields,
  cycleIdeaStatus,
  setIdeaPlace,
  setIdeaRating,
  setIdeaNote,
  scheduleFloating,
  reorderFloating,
  updateDestination,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MENU_ITEM, MENU_ITEM_WARN, MENU_SURFACE, MenuHint, RowMenu } from "./row-menu";
import { Timeline } from "./Timeline";
import { PlacePicker } from "@/components/places/PlacePicker";
import { RouteView } from "./RouteView";
import { DestinationDetailSheet } from "./DestinationDetailSheet";
import { NearbySavesBanner, NearbySavesSheet, sheetRows } from "./NearbySaves";
import { JournalLens } from "./JournalLens";
import { LastTimeHere } from "./LastTimeHere";
import { LodgingCards, RigCards, TripModeCards } from "./choice-cards";
import { IdeasLens, maybeCount } from "./IdeasLens";
import { AddStaySheet } from "./AddStaySheet";
import { AddFlightSheet } from "./AddFlightSheet";
import { HopModePrompt } from "./HopModePrompt";


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
  nearby: initialNearby,
  nextTime: initialNextTime = { cards: [], saveIds: [] },
  householdHome = null,
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
  /**
   * #111 i4 · trip surfacing: the saves near this trip at its radius, minus
   * the ones dismissed here — core's `nearbySaves`, computed on the server
   * (trips/[id]/page.tsx) so the banner is in the first paint.
   */
  nearby: NearbySaves;
  /**
   * #113 · #107 "Last time here": core's `forNextTime`, computed on the same
   * server seam. Defaulted to no cards, so a caller without it renders none.
   */
  nextTime?: ForNextTime;
  /**
   * #126 · Q5 A — the household home base (`user_prefs.home_base*`), read on
   * the same server seam. Trip settings' "Use household default" falls back to
   * it optimistically, the way `getTripById` coalesces on the next read.
   */
  householdHome?: Place | null;
}) {
  const router = useRouter();
  const [trip, setTrip] = useState(initialTrip);
  const [routes, setRoutes] = useState(initialRoutes);
  // Klunk row 8 · Q4 A: the lens follows the mode — a drive trip opens on
  // Route, a fly trip on Timeline. #113 · Q4 B: a traveled trip (status
  // `complete`, the dashboard's "Traveled") opens on its Journal. Derived,
  // never stored — the Traveled card's /trips/[id] href is the deep-link.
  // #131 · Q1 A · Q2 A — three MINDSET tabs: Itinerary · Ideas · Journal.
  // The old lenses are Itinerary's sub-lens. The derivation is kept: a
  // traveled trip opens on Journal; otherwise Itinerary, on Route for a drive
  // trip and Timeline for a fly trip.
  const [tab, setTab] = useState<"itinerary" | "ideas" | "journal">(
    initialTrip.status === "complete" ? "journal" : "itinerary",
  );
  const [sub, setSub] = useState<"route" | "timeline">(
    initialTrip.defaultMode === "drive" ? "route" : "timeline",
  );
  const lens = tab === "itinerary" ? sub : tab;
  const showRoute = () => {
    setTab("itinerary");
    setSub("route");
  };
  /** #128 · the Add stay sheet — `destinationId` null is Itinerary ▸ Add ▸ Stay. */
  const [staySheet, setStaySheet] = useState<{ destinationId: string | null } | null>(null);
  /** #129 · the Add flight (round trip) sheet. */
  const [flightSheetOpen, setFlightSheetOpen] = useState(false);
  /** #129 · Q11 A — the keep-or-remove prompt for Fly → Drive. */
  const [modePrompt, setModePrompt] = useState<{ segmentId: string; mode: TravelMode } | null>(null);
  /** #113 · the "Last time here" cards; a row's Add marks it "On shelf ✓". */
  const [nextTime, setNextTime] = useState(initialNextTime);
  /** The hop whose Add flight / Add ferry form is open (#104 · Q5 A). */
  const [openHopId, setOpenHopId] = useState<string | null>(null);
  /** A fly/ferry day clicked on the Timeline: once Route has rendered, scroll
   * that hop into view. A ref, not state — it is a one-shot DOM instruction. */
  const scrollHopId = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** The reservation form: `"new"` is the add form, an id is that row's full
   * edit, `null` is closed. One form, two jobs. */
  const [formTarget, setFormTarget] = useState<string | "new" | null>(null);
  /** The chapter or destination whose inline rename is open — set by the row menu's
   * "Rename" and by a create, so a new row lands ready to be named. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [datesDestinationId, setDatesDestinationId] = useState<string | null>(null);
  /** The chapter whose "Add destination" DRAFT row is open. The draft is not a destination — the
   * pick is the create — so dismissing it writes nothing, which is how this
   * screen stops manufacturing the coordless rows #60 exists to repair. */
  const [draftChapterId, setDraftChapterId] = useState<string | null>(null);
  /** The destination whose place editor is open. One editor, three entry points: the
   * row menu, the row's amber coordless chip, and the destination sheet's mini-map. */
  const [placingDestinationId, setPlacingDestinationId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  /** The optional place on the destination sheet's "Add idea" form. */
  const [ideaPicked, setIdeaPicked] = useState<PickedPlace | null>(null);
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null);
  const [deleteDestinationId, setDeleteDestinationId] = useState<string | null>(null);
  const [form, setForm] = useState<AddForm>(() => stayDraft(initialTrip.lodgingDefault));
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
   * is closed; the fourth branch ("A destination") is the shipped draft-destination row. */
  const [addIdeaCategory, setAddIdeaCategory] = useState<IdeaCategory | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [shelfDraft, setShelfDraft] = useState("");
  const [shelfPicked, setShelfPicked] = useState<PickedPlace | null>(null);
  /** The Add-from-Places panel — the library, filtered, one Add per row. */
  const [placesPanelOpen, setPlacesPanelOpen] = useState(false);
  /** #111 i4 · the nearby-saves banner's numbers, re-read after a radius chip
   * and on closing the review sheet. */
  const [nearby, setNearby] = useState(initialNearby);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  /** The rows added from the OPEN review sheet — kept as "✓ Idea" even after a
   * refetch drops them (they are on the trip now). Cleared on each open. */
  const [nearbyAdded, setNearbyAdded] = useState<NearbySave[]>([]);
  /** The shelf row whose place picker is open — the same #69 entrance the destination
   * sheet's idea card has, on the rail's card. */
  const [locatingShelfIdeaId, setLocatingShelfIdeaId] = useState<string | null>(null);
  const [routeDrag, setRouteDrag] = useState<{
    chapterId: string;
    destinationId: string;
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

  useEffect(() => {
    const id = scrollHopId.current;
    if (lens !== "route" || !id) return;
    scrollHopId.current = null;
    document.getElementById(`hop-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [lens, openHopId]);

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
  // — the proximity pairs are ideas × located destinations, so this stays bounded.
  const shelf = useMemo(() => ideaShelf(trip, shelfFilter), [trip, shelfFilter]);
  const route = useMemo(
    () => routeModel(trip, routes, routingHash, nav, units),
    [trip, routes, routingHash, nav, units],
  );
  const summary = useMemo(
    () => routeSummary(trip, routes, routingHash),
    [trip, routes, routingHash],
  );
  // #155 · Q3 B — the Logistics section, from the same trip.
  const logistics = useMemo(() => logisticsModel(trip), [trip]);
  const byId = useMemo(() => destinationMap(trip), [trip]);
  // Trip-wide scheduled sequence — the same ordering routeSummary() and /map use.
  const scheduledOrdinal = useMemo(
    () =>
      new Map(
        trip.chapters
          .flatMap((l) => l.destinations)
          .filter(isScheduled)
          .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!))
          .map((s, i) => [s.id, i + 1] as const),
      ),
    [trip],
  );
  const selectedDestination = selectedId ? (byId.get(selectedId) ?? null) : null;
  const selectedChapterName = selectedDestination
    ? (trip.chapters.find((l) => l.id === selectedDestination.chapterId)?.title ?? "")
    : "";
  // The three row-menu surfaces read their subject off the tree rather than
  // snapshotting it, so a rollback under an open dialog corrects what it shows.
  const deleteChapter = deleteChapterId ? (trip.chapters.find((l) => l.id === deleteChapterId) ?? null) : null;
  const deleteDestination = deleteDestinationId ? (byId.get(deleteDestinationId) ?? null) : null;
  const datesDestination = datesDestinationId ? (byId.get(datesDestinationId) ?? null) : null;

  /** Every leaf surface is per-destination, so opening or closing the sheet closes all
   * of them — a form left open over another destination would write to the wrong row. */
  const resetLeafForms = () => {
    setFormTarget(null);
    setIdeaAddOpen(false);
    setIdeaDraft("");
    setIdeaPicked(null);
    setPromotingId(null);
  };
  const openDestination = (id: string) => {
    setSelectedId(id);
    resetLeafForms();
  };
  const closeDestination = () => {
    setSelectedId(null);
    // Mount B's editor cannot outlive the sheet it was opened from — it would
    // reappear, still open, on the row behind it.
    setPlacingDestinationId(null);
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
   * The gantt drop — and the destination sheet's "Schedule" button, which has no drop
   * target and passes no gap.
   *
   * `gap` is the open span the card was dropped ON: the destination takes that gap's
   * first date and `min(3, gap.span)` days of it, so dropping on Aug 10–11
   * lands on Aug 10–11 rather than on the trip's longest empty run. `null`
   * keeps the longest-run fallback the sheet's button has always used.
   *
   * Two fields, one PATCH — no `sortOrder` write. `orderedChapterDestinations()` sorts
   * scheduled destinations by `arriveDate`, so the dates alone reorder the chapter
   * everywhere the destination appears.
   */
  const doSchedule = (id: string, gap: TimelineGap | null = null) => {
    const undo = trip;
    const next = scheduleFloating(trip, id, gap);
    if (next === undo) return; // no open day to land on — nothing happened
    setTrip(next);
    upgradeRoutes(next);
    const s = destinationMap(next).get(id);
    if (!s?.arriveDate || !s.departDate) return;
    const arriveDate = s.arriveDate;
    const departDate = s.departDate;
    persist(
      tripApi.updateDestination(id, { arriveDate, departDate }),
      undo,
      `Couldn't schedule ${s.place.name} — put back to floating.`,
    );
    // The drop is the one gesture with no dialog in front of it, so the toast
    // is where it becomes reversible: Undo puts the destination back to floating and
    // writes that back too.
    toast.success(`Scheduled ${s.place.name} · ${monthDay(arriveDate)} – ${monthDay(departDate)}`, {
      action: {
        label: "Undo",
        onClick: () => {
          setTrip(undo);
          persist(
            tripApi.updateDestination(id, { arriveDate: null, departDate: null }),
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
    setTab("ideas");
    setDraftChapterId(null);
    setPlacesPanelOpen(false);
    setShelfDraft("");
    setShelfPicked(null);
    setAddIdeaCategory(category);
  };

  /** The shelf's "+ Add" — one field plus an optional place, exactly like the
   * sheet's, but with no destination in hand. */
  const submitShelfIdea = async () => {
    if (!addIdeaCategory) return;
    const body = ideaDraftInput(
      { tripId: trip.id, destinationId: null, category: addIdeaCategory },
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
  const addIdeaFromPlace = async (p: SavedPlace): Promise<boolean> => {
    try {
      const created = await tripApi.createIdea({
        tripId: trip.id,
        destinationId: null,
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
      return true;
    } catch {
      toast.error(`Couldn't add ${p.place.name}.`);
      return false;
    }
  };

  // ── #111 i4 · trip surfacing: the banner and its review sheet ─────────────

  /** Re-read the banner's numbers. Quiet on failure: the banner keeps what it
   * had, and a surfacing hint is never worth an error. */
  const refreshNearby = () =>
    tripApi
      .nearbySaves(trip.id)
      .then(setNearby)
      .catch(() => {});

  /** Dismiss: every save the banner names, remembered for THIS trip (Q6 A).
   * The banner comes back only when a new save matches. */
  const dismissNearby = () => {
    const before = nearby;
    const saveIds = nearby.items.map((i) => i.saveId);
    setNearby({ ...nearby, items: [], beyond: null });
    tripApi.dismissSaves(trip.id, saveIds).catch(() => {
      setNearby(before);
      toast.error("Couldn't dismiss those saves.");
    });
  };

  const openNearby = () => {
    setNearbyAdded([]);
    setNearbyOpen(true);
  };

  const closeNearby = () => {
    setNearbyOpen(false);
    void refreshNearby();
  };

  /** #113 · a "Last time here" row's Add: the same shelf-idea copy the
   * nearby sheet's Add makes, then the row reads "On shelf ✓". */
  const addNextTime = async (row: NextTimeRow) => {
    try {
      const created = await tripApi.createIdea(nextTimeIdeaBody(trip.id, row));
      setTrip((t) => appendShelfIdea(t, created));
      setNextTime((nt) => markRowOnShelf(nt, row.saveId));
      toast.success(`Added ${row.name} to this trip's ideas`);
    } catch {
      toast.error(`Couldn't add ${row.name}.`);
    }
  };

  /** #113 · the Journal's trip card: `trips.rating` / `trips.note`, in place. */
  const rateTrip = (n: number) => {
    const undo = trip;
    const rating = n === 0 ? null : n;
    setTrip({ ...trip, rating });
    persist(tripApi.updateTrip(trip.id, { rating }), undo, "Couldn't save the trip's rating.");
  };
  const noteTrip = (text: string) => {
    const undo = trip;
    const note = text.trim() === "" ? null : text;
    setTrip({ ...trip, note });
    persist(tripApi.updateTrip(trip.id, { note }), undo, "Couldn't save the trip's note.");
  };

  /** A row's Add — the shipped "Add from Places" copy (`addIdeaFromPlace`),
   * the save found by id in the library the page already read. */
  const addNearby = async (item: NearbySave) => {
    const p = savedPlaces.find((s) => s.id === item.saveId);
    if (!p) return;
    if (await addIdeaFromPlace(p)) setNearbyAdded((a) => [...a, item]);
  };

  /** "Add all N to ideas" — one at a time, so the shelf's order follows the
   * sheet's (nearest first). */
  const addAllNearby = async () => {
    const done = new Set(nearbyAdded.map((i) => i.saveId));
    for (const item of sheetRows(nearby.items, nearbyAdded)) {
      if (!done.has(item.saveId)) await addNearby(item);
    }
  };

  /** A radius chip: saved to this trip, then the sheet re-reads at it. */
  const setSurfaceRadius = (r: SurfaceRadiusMi) => {
    if (r === nearby.radiusMi) return;
    const undoTrip = trip;
    const undoNearby = nearby;
    setTrip((t) => ({ ...t, surfaceRadiusMi: r }));
    setNearby((n) => ({ ...n, radiusMi: r }));
    tripApi
      .updateTrip(trip.id, { surfaceRadiusMi: r })
      .then(() => tripApi.nearbySaves(trip.id))
      .then(setNearby)
      .catch(() => {
        setTrip(undoTrip);
        setNearby(undoNearby);
        toast.error("Couldn't change the radius.");
      });
  };

  /**
   * Gesture 1 · a STAY-idea dropped on open days.
   *
   * It creates the destination immediately (Q3 → A) and links the idea to it: two
   * writes, one gesture. The dates are `planIdeaOnGap` — the SAME rule
   * `scheduleFloating` uses, so a drop on the Oct 18–24 span lands Oct 18–20 for
   * an idea exactly as it does for a floating destination. The chapter is the one owning
   * the last destination, falling back to the last chapter: the "goes on the end" rule
   * every create here already follows.
   */
  /**
   * #131 · Plan it on a STAY idea (vet MED): the Ideas tab has no gantt to
   * drop on, so the RangePicker's pick is the date range — the same create +
   * attach + Undo the drop does, with the dates handed in rather than read off
   * a `TimelineGap`.
   */
  const planIdeaOnDates = async (
    ideaId: string,
    dates: { arriveDate: string; departDate: string },
  ) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    if (!it) return;
    const chapterId = chapterOrder(trip).at(-1);
    if (!chapterId) return;
    const undo = trip;
    try {
      const created = await tripApi.createDestination({
        chapterId,
        place: it.place ?? { name: it.title, lat: null, lng: null, googlePlaceId: null },
        arriveDate: dates.arriveDate,
        departDate: dates.departDate,
      });
      const next = attachIdeaToDestination(appendDestination(trip, created), ideaId, created.id);
      setTrip(next);
      upgradeRoutes(next);
      // Held, not just fired: Undo chains off it so the detach below can never
      // overtake the attach on the wire.
      const attached = persist(
        tripApi.updateIdea(ideaId, { destinationId: created.id, status: "planned" }),
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
              // DETACH FIRST, then delete. `ideas.destination_id` is ON DELETE CASCADE
              // (packages/db/src/schema.ts:133), so deleting the destination this
              // gesture created while the idea is still attached DESTROYS the
              // idea — the rail would show it back for one session and it
              // would be gone on the next load. The PATCH puts the row (and the
              // status the plan moved to "planned") back where the undone tree
              // already shows it; only then is the destination safe to remove.
              void attached
                .then(() => tripApi.updateIdea(ideaId, { destinationId: null, status: it.status }))
                .then(() => tripApi.deleteDestination(created.id))
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

  /** #131 · Plan it on a do/eat idea: it goes to the destination you pick AND is
   * planned — so it lands on the Itinerary, which lists knowns only. */
  const planIdeaToDestination = (ideaId: string, destinationId: string) => {
    const it = trip.ideas.find((i) => i.id === ideaId);
    const destination = byId.get(destinationId);
    if (!it || !destination) return;
    const undo = trip;
    const attached = attachIdeaToDestination(trip, ideaId, destinationId);
    setTrip(
      updateDestinationIdeas(attached, destinationId, (x) => (x.id === ideaId ? { ...x, status: "planned" } : x)),
    );
    persist(
      tripApi.updateIdea(ideaId, { destinationId, status: "planned" }),
      undo,
      `Couldn't plan ${it.title} — it's back on Ideas.`,
    );
    toast.success(`Planned ${it.title} · ${destination.place.name}`);
  };

  /** #131 · Plan it on an idea already pinned to a destination — and the pinned row's
   * pill. Both are the destination idea's status write. */
  const setPinnedIdeaStatus = (destinationId: string, ideaId: string, next: (s: Idea["status"]) => Idea["status"]) => {
    const it = byId.get(destinationId)?.ideas.find((x) => x.id === ideaId);
    if (!it) return;
    const status = next(it.status);
    const undo = trip;
    setTrip(updateDestinationIdeas(trip, destinationId, (x) => (x.id === ideaId ? { ...x, status } : x)));
    persist(
      tripApi.updateIdea(ideaId, { status }),
      undo,
      `Couldn't change ${it.title} — put back the way it was.`,
    );
  };

  /** Gesture 3 · an ATTACHED idea goes back to the shelf. Legal only now that
   * `destination_id` is nullable, and it is an EXPLICIT null on the wire — absent
   * would mean "leave the attachment alone". */
  const doDetachIdea = (ideaId: string) => {
    const it = allDestinations(trip)
      .flatMap((st) => st.ideas)
      .find((x) => x.id === ideaId);
    if (!it) return;
    const undo = trip;
    setTrip(detachIdeaToShelf(trip, ideaId));
    persist(
      tripApi.updateIdea(ideaId, { destinationId: null }),
      undo,
      `Couldn't move ${it.title} — it's back under its destination.`,
    );
  };

  /** The shelf card's own leaf writes: the status pill and the delete. They go
   * through the SAME endpoints the sheet's card uses — #80's whole ownership
   * move is what makes them reach a row with a null destination_id at all. */
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
   * TWO NEW handlers, not a re-thread of the destination sheet's three. Those are
   * destination-scoped by construction: `setIdeaRating(trip, selectedDestination.id, …)` and
   * `setIdeaNote(…)` both walk into a destination's `ideas`, and an unattached idea is
   * not in any destination's — it lives in `trip.ideas`. So the shelf's pad writes
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

  // ── chapters ─────────────────────────────────────────────────────────────────
  //
  // A CREATE is the one write with nothing to be optimistic about — only the
  // server can mint the id — so it awaits the 201 and splices the row it hands
  // back. Everything else applies to the tree first and hands persist() the
  // trip it was applied to, which is what a failure puts back.

  const addChapter = async () => {
    try {
      // #155 · Q1 A — an UNNAMED chapter (as a new trip's first one is); its
      // inline rename opens straight away to name it.
      const chapter = await tripApi.createChapter({ tripId: trip.id, title: null });
      setTrip((t) => appendChapter(t, chapter));
      showRoute();
      setRenamingId(chapter.id);
    } catch {
      toast.error("Couldn't add a chapter — nothing was created.");
    }
  };

  const doRenameChapter = (chapterId: string, title: string) => {
    const undo = trip;
    const was = trip.chapters.find((l) => l.id === chapterId)?.title ?? "that chapter";
    setTrip(renameChapter(trip, chapterId, title));
    persist(
      tripApi.updateChapter(chapterId, { title }),
      undo,
      `Couldn't rename ${was} — the old name is back.`,
    );
  };

  /** "Move chapter up/down" — the whole new order travels, never a swap. */
  const doMoveChapter = (chapterId: string, delta: -1 | 1) => {
    const undo = trip;
    const next = moveChapter(trip, chapterId, delta);
    if (next === undo) return;
    setTrip(next);
    upgradeRoutes(next);
    persist(
      tripApi.reorderChapters(trip.id, chapterOrder(next)),
      undo,
      "Couldn't save that order — put back the way it was.",
    );
  };

  const doDeleteChapter = (chapterId: string) => {
    setDeleteChapterId(null);
    const chapter = trip.chapters.find((l) => l.id === chapterId);
    if (!chapter) return;
    const undo = trip;
    // The sheet cannot outlive the destination it is showing.
    if (chapter.destinations.some((s) => s.id === selectedId)) closeDestination();
    setTrip(removeChapter(trip, chapterId));
    persist(
      tripApi.deleteChapter(chapterId),
      undo,
      `Couldn't delete ${chapter.title ?? "that chapter"} — the chapter and its destinations are back.`,
    );
  };

  // ── destinations ────────────────────────────────────────────────────────────────

  /**
   * "Add destination" no longer creates anything: it appends a DRAFT row to the chapter
   * and opens the picker inside it, biased to the destination above. Nothing is
   * written until a place is chosen — which is the whole of #60's headline fix,
   * because the old path posted a literal "New destination" with three null columns
   * that no patch could ever repair.
   */
  const openDraftDestination = (chapterId: string) => {
    showRoute();
    setPlacingDestinationId(null);
    setDraftChapterId(chapterId);
  };

  /** The pick IS the create: name, coordinates and place id in one write, so
   * the destination is born mapped and its connector resolves immediately. */
  const createDestinationFromPick = async (chapterId: string, picked: PickedPlace) => {
    const body = destinationPlaceCreate(chapterId, picked);
    if (!body) return;
    setDraftChapterId(null);
    try {
      const created = await tripApi.createDestination(body);
      const next = appendDestination(trip, created);
      setTrip(next);
      upgradeRoutes(next);
    } catch {
      toast.error("Couldn't add a destination — nothing was created.");
    }
  };

  /**
   * "Change place…" / "Set place" — the whole place at once, which is the one
   * thing the rename can never do. The place REPLACES the old one, so a
   * re-picked free-text name honestly clears the coordinates rather than
   * leaving a pin at the last spot under a new label.
   */
  const doChangeDestinationPlace = (destinationId: string, picked: PickedPlace) => {
    const patch = destinationPlacePatch(picked);
    if (!patch?.place) return;
    setPlacingDestinationId(null);
    const undo = trip;
    const was = byId.get(destinationId)?.place.name ?? "that destination";
    const next = setDestinationPlace(trip, destinationId, patch.place);
    setTrip(next);
    upgradeRoutes(next);
    persist(
      tripApi.updateDestination(destinationId, patch),
      undo,
      `Couldn't change the place for ${was} — the old one is back.`,
    );
  };

  /**
   * The rail's Locate — the same bounded batch /map already ships, pointed at
   * the planner's coordless DESTINATIONS (`locateRowKind` has always been
   * `["place","destination"]`).
   *
   * It refreshes rather than echoing: `LocateResponse` returns only id/lat/lng,
   * not the `googlePlaceId` the server also wrote, so a local echo would leave
   * the client's place id permanently stale — and the drives have to be
   * re-resolved server-side anyway.
   */
  const locateUnmapped = () => {
    const batch = summary.unmappedDestinations.slice(0, LOCATE_MAX_ROWS);
    if (batch.length === 0) return;
    setLocating(true);
    tripApi
      .locatePlaces(batch.map((row) => ({ kind: "destination" as const, id: row.id })))
      .then(({ located, results }) => {
        const found = new Set(results.map((r) => r.id));
        const stuck = batch.filter((row) => !found.has(row.id)).map((row) => row.name);
        toast.success(locateToastMessage(located, stuck));
        router.refresh();
      })
      .catch(() => toast.error("Locate didn't run — check your connection."))
      .finally(() => setLocating(false));
  };

  const doRenameDestination = (destinationId: string, name: string) => {
    const undo = trip;
    const was = byId.get(destinationId)?.place.name ?? "that destination";
    setTrip(renameDestination(trip, destinationId, name));
    persist(
      tripApi.updateDestination(destinationId, { placeName: name }),
      undo,
      `Couldn't rename ${was} — the old name is back.`,
    );
  };

  /** The destination-dates dialog's Save. Both dates travel together. #127 · Q7 B:
   * with "Extend trip" pressed, the trip's dates move first, in the same save. */
  const saveDestinationDates = (destinationId: string, draft: DestinationDatesDraft, extend: DateSpan | null = null) => {
    setDatesDestinationId(null);
    const destination = byId.get(destinationId);
    if (!destination) return;
    const patch = destinationDatesPatch(destination, draft);
    if (patch === null || Object.keys(patch).length === 0) return;
    const undo = trip;
    const widened = extend ? { ...trip, startDate: extend.start, endDate: extend.end } : trip;
    const next = setDestinationDates(widened, destinationId, patch.arriveDate ?? null, patch.departDate ?? null);
    setTrip(next);
    upgradeRoutes(next);
    const write = extend
      ? tripApi
          .updateTrip(trip.id, { startDate: extend.start, endDate: extend.end })
          .then(() => tripApi.updateDestination(destinationId, patch))
      : tripApi.updateDestination(destinationId, patch);
    persist(write, undo, `Couldn't save those dates — ${destination.place.name} is back where it was.`);
  };

  /** One PATCH setting BOTH dates to null: the destination drops back to floating. */
  const doUnschedule = (destinationId: string) => {
    setDatesDestinationId(null);
    const destination = byId.get(destinationId);
    if (!destination || !isScheduled(destination)) return;
    const undo = trip;
    const next = setDestinationDates(trip, destinationId, null, null);
    setTrip(next);
    upgradeRoutes(next);
    persist(
      tripApi.updateDestination(destinationId, unscheduleDestinationPatch()),
      undo,
      `Couldn't unschedule ${destination.place.name} — the dates are back.`,
    );
  };

  const doMoveDestinationToChapter = (destinationId: string, chapterId: string) => {
    const undo = trip;
    const next = moveDestinationToChapter(trip, destinationId, chapterId);
    if (next === undo) return;
    const moved = destinationMap(next).get(destinationId);
    if (!moved) return;
    setTrip(next);
    upgradeRoutes(next);
    persist(
      // The target chapter AND the position it was appended at — the server
      // appends too, but only the client knows the row is going to the end of
      // a chapter it is already holding.
      tripApi.updateDestination(destinationId, { chapterId, sortOrder: moved.sortOrder }),
      undo,
      `Couldn't move ${moved.place.name} — it's back in the chapter it came from.`,
    );
  };

  const doDeleteDestination = (destinationId: string) => {
    setDeleteDestinationId(null);
    const destination = byId.get(destinationId);
    if (!destination) return;
    const undo = trip;
    if (selectedId === destinationId) closeDestination();
    setTrip(removeDestination(trip, destinationId));
    persist(
      tripApi.deleteDestination(destinationId),
      undo,
      `Couldn't delete ${destination.place.name} — the destination is back.`,
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
    // #126 · Q5 A — a cleared override reads the household default again.
    const merged = { ...trip, ...patch };
    const home =
      patch.homeBase !== undefined
        ? resolveHomeBase(
            { homeBase: patch.homeBase ?? null, homeBasePlace: patch.homeBasePlace ?? null },
            householdHome,
          )
        : null;
    setTrip(
      withReconciledSegments(
        home
          ? {
              ...merged,
              homeBase: home.homeBase,
              homeBasePlace: home.homeBasePlace,
              homeBaseFromHousehold: home.fromHousehold,
            }
          : merged,
      ),
    );
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

  /** "Add" opens on Stay, with the trip's lodging default as its kind (#105 ·
   * Q3 A) — Campground on PNW, Hotel on Costa Rica and Greece. */
  const openAddReservation = () => {
    setForm(stayDraft(trip.lodgingDefault));
    setFormTarget("new");
  };

  /** The full edit: the same form, seeded from the row it is editing. */
  const openEditReservation = (resId: string) => {
    const r = selectedDestination?.reservations.find((x) => x.id === resId);
    if (!r) return;
    setForm(reservationDraft(r));
    setFormTarget(resId);
  };

  const submitReservationForm = async () => {
    if (!selectedId || !formTarget) return;
    if (formTarget === "new") {
      const body = reservationDraftInput(selectedId, form);
      if (!body) return;
      const destinationId = selectedId;
      try {
        // A create is the one write with nothing to be optimistic about: only
        // the server can mint the id, so it awaits the 201 and splices the row.
        const row = await tripApi.createReservation(body);
        setTrip((t) => appendReservation(t, destinationId, row));
        setForm(stayDraft(trip.lodgingDefault));
        setFormTarget(null);
      } catch {
        toast.error("Couldn't save that reservation.");
      }
      return;
    }
    const r = selectedDestination?.reservations.find((x) => x.id === formTarget);
    if (!r || !selectedDestination) return;
    const patch = reservationDraftPatch(r, form);
    if (patch === null) return;
    setFormTarget(null);
    if (Object.keys(patch).length === 0) return;
    const undo = trip;
    // The sheet lists only its destination's reservations (#110 Q2 A), so the row's
    // parent IS the open destination.
    setTrip(setReservationFields(trip, selectedDestination.id, r.id, patch));
    persist(
      tripApi.updateReservation(r.id, patch),
      undo,
      `Couldn't save ${r.name} — your changes are back as they were.`,
    );
  };

  const doDeleteReservation = (resId: string) => {
    const r = selectedDestination?.reservations.find((x) => x.id === resId);
    if (!r || !selectedDestination) return;
    if (formTarget === resId) setFormTarget(null);
    const undo = trip;
    const next = removeReservation(trip, selectedDestination.id, resId);
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
      // The re-POSTed row is destination-attached by construction.
      setTrip((t) => (row.destinationId ? appendReservation(t, row.destinationId, row) : t));
    } catch {
      toast.error(`Couldn't put ${r.name} back.`);
    }
  };

  const submitIdea = async () => {
    if (!selectedId) return;
    // The place is optional and the title is not: a place without a title is
    // not an idea, which is exactly what `ideaDraftInput` refuses.
    // The sheet's form always has a destination in hand; the shelf's "+ Add" is the
    // one with none (#80).
    const body = ideaDraftInput(
      { tripId: trip.id, destinationId: selectedId },
      ideaDraft,
      ideaPicked,
    );
    if (!body) return;
    const destinationId = selectedId;
    try {
      const created = await tripApi.createIdea(body);
      setTrip((t) => appendIdea(t, destinationId, created));
      setIdeaDraft("");
      setIdeaPicked(null);
      setIdeaAddOpen(false);
    } catch {
      toast.error("Couldn't save that idea.");
    }
  };

  const doDeleteIdea = (ideaId: string) => {
    const it = selectedDestination?.ideas.find((x) => x.id === ideaId);
    if (!it || it.destinationId === null) return;
    if (promotingId === ideaId) setPromotingId(null);
    const undo = trip;
    setTrip(removeIdea(trip, it.destinationId, ideaId));
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
      // back as a shelf idea, not as a fresh maybe under a destination.
      setTrip((t) =>
        created.destinationId === null
          ? appendShelfIdea(t, created)
          : appendIdea(t, created.destinationId, created),
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
    if (!ideaId || !selectedDestination) return;
    const destinationId = selectedDestination.id;
    setPromotingId(null);
    try {
      const row = await tripApi.promoteIdea(ideaId, promoteType);
      setTrip((t) => applyPromotion(t, destinationId, ideaId, row));
    } catch {
      toast.error("Couldn't book that idea.");
    }
  };

  // ── #104 · hops: the mode switch and the bookings on a hop ─────────────────

  /** Drive / Fly / Ferry — `PATCH /api/segments/:id`, optimistic. A drive that
   * flies leaves `drivePairs`, taking its Navigate, rail miles and HERE call
   * with it; a hop driven again is routed in the background. */
  const doSetHopMode = (segmentId: string, mode: TravelMode, bookings?: SegmentBookingsChoice) => {
    const seg = trip.segments.find((s) => s.id === segmentId);
    if (!seg || seg.mode === mode) return;
    // #129 · Q11 A — flights on a hop going to Drive: ask, don't refuse (the
    // toast that used to stand here is gone — vet MED 3).
    if (mode === "drive" && seg.reservations.length > 0 && bookings === undefined) {
      setModePrompt({ segmentId, mode });
      return;
    }
    const undo = trip;
    const next = setSegmentMode(trip, segmentId, mode, bookings ?? "keep");
    setTrip(next);
    if (mode === "drive") upgradeRoutes(next);
    else setOpenHopId(null);
    persist(
      tripApi.updateSegment(segmentId, bookings ? { mode, bookings } : { mode }),
      undo,
      "Couldn't change how that hop travels — put back the way it was.",
    );
  };

  /** #124 · a hop booking's Edit — `PATCH` with its clock; the hop re-times.
   * Awaited, not optimistic: a 409 (the new date misses the destination) keeps the
   * form open with the old flight still on the card. */
  const editHopBooking = async (resId: string, patch: ReservationPatchInput): Promise<boolean> => {
    if (Object.keys(patch).length === 0) return true;
    try {
      await tripApi.updateReservation(resId, patch);
      setTrip((t) =>
        editSegmentBooking(t, resId, {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.startsAt !== undefined && { startsAt: patch.startsAt, startsTz: patch.startsTz ?? null }),
          ...(patch.endsAt !== undefined && { endsAt: patch.endsAt, endsTz: patch.endsTz ?? null }),
        }),
      );
      return true;
    } catch {
      toast.error("Couldn't save that flight — its date may disagree with the destination.");
      return false;
    }
  };

  /** #129 · Q10 A — both boundary flights in one save; the reply is the whole
   * trip (the → home hop may be new), swapped in. */
  const saveBoundaryFlights = async (body: BoundaryFlightsBody): Promise<boolean> => {
    try {
      const next = await tripApi.boundaryFlights(trip.id, body);
      setTrip(next);
      setFlightSheetOpen(false);
      toast.success(body.roundTrip ? "Saved both flights" : "Saved the flight");
      return true;
    } catch {
      toast.error(
        trip.homeBase
          ? "Couldn't save those flights — check their dates against the destination."
          : "Set a home base first — flights go from home.",
      );
      return false;
    }
  };

  /** #128 · Save stay. With no destination yet, the place and its nights BECOME the
   * destination first (the trip's last chapter), then the stay hangs on it. */
  const saveStay = async (input: {
    destinationId: string | null;
    place: PickedPlace;
    draft: ReservationDraft;
  }): Promise<boolean> => {
    try {
      let destinationId = input.destinationId;
      let working = trip;
      if (!destinationId) {
        const chapterId = chapterOrder(trip).at(-1);
        const body = chapterId ? destinationPlaceCreate(chapterId, input.place) : null;
        if (!body) return false;
        const created = await tripApi.createDestination({
          ...body,
          arriveDate: input.draft.checkIn,
          departDate: input.draft.checkOut,
        });
        working = appendDestination(trip, created);
        destinationId = created.id;
      }
      const body = reservationDraftInput(destinationId, input.draft);
      if (!body) return false;
      const row = await tripApi.createReservation(body);
      const next = appendReservation(working, destinationId, row);
      setTrip(next);
      upgradeRoutes(next);
      setStaySheet(null);
      toast.success(`Saved ${row.name}`);
      return true;
    } catch {
      toast.error("Couldn't save that stay — nothing was saved.");
      return false;
    }
  };

  /** "Just considering? Save it as an idea instead." A picked place becomes a
   * stay idea on the shelf; with nothing picked, the Ideas draft opens. */
  const saveStayAsIdea = async (picked: PickedPlace | null) => {
    setStaySheet(null);
    if (!picked) {
      openAddIdea("stay");
      return;
    }
    try {
      const created = await tripApi.createIdea({
        tripId: trip.id,
        destinationId: null,
        category: "stay",
        title: picked.name,
        status: "idea",
        place: ideaPlace(picked),
      });
      setTrip((t) => appendShelfIdea(t, created));
      toast.success(`Added ${picked.name} to this trip's ideas`);
    } catch {
      toast.error(`Couldn't add ${picked.name}.`);
    }
  };

  /** Save flight / Save ferry — and, with `moveDestination`, Q8 A's "Check out of …
   * instead": the booking and the destination's new date in ONE request. A create is
   * not optimistic (only the server mints the id), so it awaits the 201. */
  const saveHopBooking = async (body: ReservationCreateInput, moveDestination: boolean) => {
    try {
      const row = await tripApi.createReservation(moveDestination ? { ...body, moveDestination: true } : body);
      setTrip((t) => withReconciledSegments(applyHopBooking(t, row, moveDestination)));
      setOpenHopId(null);
      return true;
    } catch {
      toast.error("Couldn't save that booking — nothing was saved.");
      return false;
    }
  };

  /** A flight or ferry removed from its hop: optimistic, with the leaf undo. */
  const doDeleteHopBooking = (resId: string) => {
    const r = trip.segments.flatMap((s) => s.reservations).find((x) => x.id === resId);
    if (!r) return;
    const undo = trip;
    setTrip(removeSegmentBooking(trip, resId));
    persist(tripApi.deleteReservation(resId), undo, `Couldn't delete ${r.name} — it's back.`);
    toast.success(`Deleted ${r.name}`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () =>
          void tripApi
            .createReservation(reservationRestoreInput(r))
            .then((row) => setTrip((t) => applyHopBooking(t, row, false)))
            .catch(() => toast.error(`Couldn't put ${r.name} back.`)),
      },
    });
  };

  /** Q5 A · a fly or ferry day on the Timeline: switch to Route, scroll to
   * that hop, and open its Add flight (or Add ferry) form. */
  const openHopFromTimeline = (segmentId: string) => {
    scrollHopId.current = segmentId;
    showRoute();
    setOpenHopId(segmentId);
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
      // The trip rides along (#103): a trip that leaves the rig home is keyed
      // without it, so the reply's hash matches this page's.
      .routePairs(
        missing.map((p) => ({ from: p.from, to: p.to })),
        next.id,
      )
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
  const ideaCount = maybeCount(trip);

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
              {/* #126 · Q4 A — where the trip is going leads the meta line. */}
              {trip.area && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4 text-rv-green" />
                    {trip.area.name}
                  </span>
                  <Dot />
                </>
              )}
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
              <ToggleTab active={tab === "itinerary"} onClick={() => setTab("itinerary")}>
                <Route className="size-4" />
                Itinerary
              </ToggleTab>
              <ToggleTab active={tab === "ideas"} onClick={() => setTab("ideas")}>
                <Lightbulb className="size-4" />
                Ideas
                <small className="font-mono text-[11px] text-rv-ink-faded">{ideaCount}</small>
              </ToggleTab>
              <ToggleTab active={tab === "journal"} onClick={() => setTab("journal")}>
                <BookOpen className="size-4" />
                Journal
              </ToggleTab>
            </div>
            <PrefSwitch checked={costTracking} onChange={changeCostTracking} label="Track costs" />
            {/* #131 · the Add verb keeps its shipped trigger and offers only
                what fits the tab: Itinerary adds KNOWNS (a flight, a stay, a
                destination), Ideas adds MAYBES (the three idea kinds, or a copy from
                your Places). On Journal it is hidden — the Journal lens (#113)
                keeps its own per-row "How was it?". A destination still has no chapter in
                hand, so it appends to the LAST one; createTrip seeds one unnamed chapter. */}
            {tab !== "journal" && (
              <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
                <DropdownMenuTrigger
                  disabled={trip.chapters.length === 0}
                  className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-accent-deep px-4 py-[9px] text-[14px] font-semibold text-rv-accent-ink disabled:cursor-default disabled:opacity-45 md:ml-0"
                >
                  <Plus className="size-4" />
                  Add
                  <ChevronDown className="size-3.5" />
                </DropdownMenuTrigger>
                {tab === "itinerary" ? (
                  <DropdownMenuContent align="end" className={MENU_SURFACE}>
                    <MenuHead>Add to Itinerary · the knowns</MenuHead>
                    <DropdownMenuItem className={MENU_ITEM} onSelect={() => setFlightSheetOpen(true)}>
                      <Plane />
                      Flight
                      <MenuHint>round trip on</MenuHint>
                    </DropdownMenuItem>
                    <DropdownMenuItem className={MENU_ITEM} onSelect={() => setStaySheet({ destinationId: null })}>
                      <Bed />
                      Stay
                      <MenuHint>hotel · campground · friends</MenuHint>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className={MENU_ITEM}
                      onSelect={() => {
                        const chapterId = chapterOrder(trip).at(-1);
                        if (chapterId) openDraftDestination(chapterId);
                      }}
                    >
                      <MapPin />
                      A destination
                      <MenuHint>on the plan</MenuHint>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="mx-0.5 my-1 bg-rv-border-soft" />
                    <MenuHead>Not sure yet?</MenuHead>
                    <DropdownMenuItem className={MENU_ITEM} onSelect={() => setTab("ideas")}>
                      <span className="font-medium text-rv-ink-faded">Switch to Ideas →</span>
                      <MenuHint>idea · save</MenuHint>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                ) : (
                  <DropdownMenuContent align="end" className={MENU_SURFACE}>
                    <MenuHead>Add to Ideas · the maybes</MenuHead>
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
                    <DropdownMenuSeparator className="mx-0.5 my-1 bg-rv-border-soft" />
                    <DropdownMenuItem className={MENU_ITEM} onSelect={() => setPlacesPanelOpen(true)}>
                      <Library />
                      Add from Places
                      <MenuHint>your saves</MenuHint>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            )}
          </div>
        </div>

        {tab === "journal" ? (
          <JournalLens trip={trip} onRateTrip={rateTrip} onNoteTrip={noteTrip} />
        ) : tab === "ideas" ? (
          <IdeasLens
            trip={trip}
            shelf={shelf}
            shelfFilter={shelfFilter}
            onShelfFilter={setShelfFilter}
            top={
              <>
                {/* #131 · the maybes moved here from above the lenses:
                    "Last time here" (#113 · #107), the saves near this trip
                    (#111 i4), and the two ways a maybe is created. */}
                <LastTimeHere nextTime={nextTime} onAdd={(row) => void addNextTime(row)} />
                <NearbySavesBanner nearby={nearby} onOpen={openNearby} onDismiss={dismissNearby} />
                {nearbyOpen && (
                  <NearbySavesSheet
                    tripTitle={trip.title}
                    nearby={nearby}
                    rows={sheetRows(nearby.items, nearbyAdded)}
                    added={new Set(nearbyAdded.map((i) => i.saveId))}
                    onAdd={(item) => void addNearby(item)}
                    onAddAll={() => void addAllNearby()}
                    onRadius={setSurfaceRadius}
                    onClose={closeNearby}
                  />
                )}
                {addIdeaCategory && (
                  <ShelfIdeaDraft
                    category={addIdeaCategory}
                    title={shelfDraft}
                    picked={shelfPicked}
                    near={searchAnchor(trip, { kind: "ideas" })}
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
              </>
            }
            onAddFromPlaces={() => setPlacesPanelOpen((v) => !v)}
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
                  near={searchAnchor(trip, { kind: "ideas" })}
                />
              ) : undefined
            }
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
            onCyclePinned={(destinationId, ideaId) =>
              setPinnedIdeaStatus(destinationId, ideaId, (st) =>
                st === "idea" ? "planned" : st === "planned" ? "done" : "idea",
              )
            }
            onPlanStay={(ideaId, span) =>
              void planIdeaOnDates(ideaId, { arriveDate: span.start, departDate: span.end })
            }
            onPlanToDestination={planIdeaToDestination}
            onPlanPinned={(destinationId, ideaId) => setPinnedIdeaStatus(destinationId, ideaId, () => "planned")}
          />
        ) : (
          <>
            {/* #131 · Itinerary's sub-lens — the old Route · Timeline lenses,
                on the DS SegmentedControl (mono). */}
            <div className="mb-3.5">
              <SegmentedControl
                mono
                value={sub}
                onChange={setSub}
                options={[
                  { value: "route", label: "Route", Icon: Route },
                  { value: "timeline", label: "Timeline", Icon: ChartNoAxesGantt },
                ]}
              />
            </div>
            {sub === "timeline" ? (
              <Timeline
                model={timeline}
                onOpenDestination={openDestination}
                onSchedule={doSchedule}
                onOpenHop={openHopFromTimeline}
              />
            ) : (
              <RouteView
                chapters={route}
                countKicker={routeCountKicker(trip)}
                logistics={logistics}
                trip={trip}
                summary={summary}
                costs={costTracking}
                hasRig={hasRig}
                units={units}
                onOpenDestination={openDestination}
                routeDrag={routeDrag}
                actions={{
                  renamingId,
                  // Renaming and changing the place are two editors for one row;
                  // opening either closes the other.
                  onStartRename: (id) => {
                    setPlacingDestinationId(null);
                    setRenamingId(id);
                  },
                  onRenameDone: () => setRenamingId(null),
                  onRenameChapter: doRenameChapter,
                  onAddDestination: openDraftDestination,
                  onAddChapter: () => void addChapter(),
                  onMoveChapter: doMoveChapter,
                  canMoveChapter: (chapterId, delta) => canMoveChapter(trip, chapterId, delta),
                  onDeleteChapter: setDeleteChapterId,
                  onRenameDestination: doRenameDestination,
                  onEditDestinationDates: setDatesDestinationId,
                  onUnscheduleDestination: doUnschedule,
                  onMoveDestinationToChapter: doMoveDestinationToChapter,
                  onDeleteDestination: setDeleteDestinationId,
                  draftChapterId,
                  onPickDraftDestination: (chapterId, picked) => void createDestinationFromPick(chapterId, picked),
                  onCancelDraftDestination: () => setDraftChapterId(null),
                  placingDestinationId,
                  onStartChangePlace: (destinationId) => {
                    setDraftChapterId(null);
                    setRenamingId(null);
                    setPlacingDestinationId(destinationId);
                  },
                  onChangeDestinationPlace: doChangeDestinationPlace,
                  onCancelChangePlace: () => setPlacingDestinationId(null),
                  locating,
                  onLocate: locateUnmapped,
                  openHopId,
                  hops: {
                    onMode: doSetHopMode,
                    onOpenForm: setOpenHopId,
                    onSave: saveHopBooking,
                    onDelete: doDeleteHopBooking,
                    onEdit: editHopBooking,
                  },
                  onAddStay: (destinationId) => setStaySheet({ destinationId }),
                }}
                onRowDragStart={(chapterId, destinationId) => setRouteDrag({ chapterId, destinationId })}
                onRowDragEnd={() => setRouteDrag(null)}
                onRowDrop={(chapterId, targetId) => {
                  if (routeDrag && routeDrag.chapterId === chapterId) {
                    const undo = trip;
                    const next = reorderFloating(trip, chapterId, routeDrag.destinationId, targetId);
                    setTrip(next);
                    upgradeRoutes(next);
                    const chapter = next.chapters.find((l) => l.id === chapterId);
                    if (chapter) {
                      const order = [...chapter.destinations]
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((s) => s.id);
                      persist(
                        tripApi.reorderChapter(chapterId, order),
                        undo,
                        "Couldn't save that order — put back the way it was.",
                      );
                    }
                  }
                  setRouteDrag(null);
                }}
              />
            )}
          </>
        )}
      </div>

      {selectedDestination && (
        <DestinationDetailSheet
          destination={selectedDestination}
          chapterName={selectedChapterName}
          destinationOrdinal={scheduledOrdinal.get(selectedDestination.id) ?? null}
          costs={costTracking}
          lodgingDefault={trip.lodgingDefault}
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
              setTrip(setIdeaPlace(trip, selectedDestination.id, ideaId, place));
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
              // this row lives under a destination.
              const undo = trip;
              setTrip(setIdeaPlace(trip, selectedDestination.id, ideaId, null));
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
          placing={placingDestinationId === selectedDestination.id}
          placeNear={searchAnchor(trip, {
            kind: "after",
            destinationId: destinationAbove(trip, selectedDestination.id)?.id ?? null,
          })}
          destinationNear={searchAnchor(trip, { kind: "destination", destinationId: selectedDestination.id })}
          tripSpan={{ start: trip.startDate, end: trip.endDate }}
          onStartChangePlace={() => setPlacingDestinationId(selectedDestination.id)}
          onChangePlace={(picked) => doChangeDestinationPlace(selectedDestination.id, picked)}
          onCancelChangePlace={() => setPlacingDestinationId(null)}
          onClose={closeDestination}
          onSchedule={() => doSchedule(selectedDestination.id)}
          onSetRating={(n) => {
            const undo = trip;
            const next = setDestinationRating(trip, selectedDestination.id, n);
            setTrip(next);
            persist(
              tripApi.updateDestination(selectedDestination.id, {
                rating: destinationMap(next).get(selectedDestination.id)?.rating ?? null,
              }),
              undo,
              "Couldn't save that rating — the old rating is back.",
            );
          }}
          onSetNote={(v) => {
            beginNoteEdit();
            setTrip((t) => setDestinationNote(t, selectedDestination.id, v));
          }}
          onCommitNote={() =>
            persist(
              tripApi.updateDestination(selectedDestination.id, {
                notes: byId.get(selectedDestination.id)?.notes ?? "",
              }),
              takeNoteUndo(),
              "Couldn't save that note — the old note is back.",
            )
          }
          onResRating={(resId, n) => {
            const undo = trip;
            const next = setReservationRating(trip, selectedDestination.id, resId, n);
            setTrip(next);
            const r = destinationMap(next)
              .get(selectedDestination.id)
              ?.reservations.find((x) => x.id === resId);
            persist(
              tripApi.updateReservation(resId, { rating: r?.rating ?? null }),
              undo,
              "Couldn't save that rating — the old rating is back.",
            );
          }}
          onResNote={(resId, v) => {
            beginNoteEdit();
            setTrip((t) => setReservationNote(t, selectedDestination.id, resId, v));
          }}
          onCommitResNote={(resId) => {
            const r = byId.get(selectedDestination.id)?.reservations.find((x) => x.id === resId);
            persist(
              tripApi.updateReservation(resId, { notes: r?.notes ?? "" }),
              takeNoteUndo(),
              "Couldn't save that note — the old note is back.",
            );
          }}
          onIdeaCycle={(ideaId) => {
            const undo = trip;
            const next = cycleIdeaStatus(trip, selectedDestination.id, ideaId);
            setTrip(next);
            const it = destinationMap(next)
              .get(selectedDestination.id)
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
            const next = setIdeaRating(trip, selectedDestination.id, ideaId, n);
            setTrip(next);
            const it = destinationMap(next)
              .get(selectedDestination.id)
              ?.ideas.find((x) => x.id === ideaId);
            persist(
              tripApi.updateIdea(ideaId, { rating: it?.rating ?? null }),
              undo,
              "Couldn't save that rating — the old rating is back.",
            );
          }}
          onIdeaNote={(ideaId, v) => {
            beginNoteEdit();
            setTrip((t) => setIdeaNote(t, selectedDestination.id, ideaId, v));
          }}
          onCommitIdeaNote={(ideaId) => {
            const it = byId.get(selectedDestination.id)?.ideas.find((x) => x.id === ideaId);
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
      {deleteChapter && (
        <CascadeDeleteConfirm
          open
          onOpenChange={(open) => !open && setDeleteChapterId(null)}
          title={deleteChapter.title ? `Delete “${deleteChapter.title}”?` : "Delete this chapter?"}
          counts={chapterCascadeCounts(deleteChapter)}
          action="Delete chapter"
          onConfirm={() => doDeleteChapter(deleteChapter.id)}
        />
      )}

      {deleteDestination && (
        <CascadeDeleteConfirm
          open
          onOpenChange={(open) => !open && setDeleteDestinationId(null)}
          title={`Delete “${deleteDestination.place.name}”?`}
          counts={destinationCascadeCounts(deleteDestination)}
          action="Delete destination"
          onConfirm={() => doDeleteDestination(deleteDestination.id)}
        />
      )}

      <DestinationDatesDialog
        destination={datesDestination}
        chapterName={datesDestination ? (trip.chapters.find((l) => l.id === datesDestination.chapterId)?.title ?? "") : ""}
        range={{ startDate: trip.startDate, endDate: trip.endDate }}
        onOpenChange={(open) => !open && setDatesDestinationId(null)}
        onSave={saveDestinationDates}
        onUnschedule={doUnschedule}
      />

      {staySheet && (
        <AddStaySheet
          trip={trip}
          destinationId={staySheet.destinationId}
          onClose={() => setStaySheet(null)}
          onSave={saveStay}
          onSaveIdea={(p) => void saveStayAsIdea(p)}
        />
      )}

      {flightSheetOpen && (
        <AddFlightSheet
          trip={trip}
          onClose={() => setFlightSheetOpen(false)}
          onSave={saveBoundaryFlights}
        />
      )}

      {modePrompt && (
        <HopModePrompt
          from={trip.segments.find((s) => s.id === modePrompt.segmentId)?.mode ?? "fly"}
          bookings={trip.segments.find((s) => s.id === modePrompt.segmentId)?.reservations ?? []}
          onCancel={() => setModePrompt(null)}
          onChoose={(choice) => {
            const { segmentId, mode } = modePrompt;
            setModePrompt(null);
            doSetHopMode(segmentId, mode, choice);
          }}
        />
      )}
    </div>
  );
}

/** A destination's ideas, rewritten one by one — the Plan it / pinned-pill writes. */
function updateDestinationIdeas(trip: Trip, destinationId: string, f: (i: Idea) => Idea): Trip {
  return updateDestination(trip, destinationId, (s) => ({ ...s, ideas: s.ideas.map(f) }));
}

/** A menu's small mono section head ("Add to Itinerary · the knowns"). */
function MenuHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-rv-ink-faded">
      {children}
    </div>
  );
}


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
  // The dialog opened on the household's place and nothing has been picked.
  const usesHousehold =
    !!trip.homeBaseFromHousehold && draft.homeBasePlace?.name === trip.homeBase;
  // Refused, not clamped: deriveDays drops days outside the trip window, so a
  // range that leaves a scheduled destination outside it would make the destination invisible
  // rather than wrong. The client holds the whole tree, so it says so here —
  // with the same sentence the server's 409 carries.
  const orphans = rangeOk
    ? destinationsOutsideRange({ startDate: draft.startDate, endDate: draft.endDate }, allDestinations(trip))
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
        {/* #103 · klunk row 7 — the setup's three answers, so none of them is
            permanent. Greece ("A mix", stored fly) reopens as Fly & stay. A new
            mode reaches only the hops added from now on. */}
        <div className="flex flex-col gap-1">
          <FieldLabel>How it moves</FieldLabel>
          <TripModeCards
            value={draft.mode}
            withSubs={false}
            onChange={(mode) => set({ mode, rigOn: mode === "road" ? draft.rigOn : false })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Mostly sleeping in</FieldLabel>
          <LodgingCards
            mode={draft.mode}
            value={draft.lodgingDefault}
            onChange={(lodgingDefault) => set({ lodgingDefault })}
          />
        </div>
        {draft.mode === "road" && (
          <div className="flex flex-col gap-1">
            <FieldLabel>Bringing the rig?</FieldLabel>
            <RigCards value={draft.rigOn} onChange={(rigOn) => set({ rigOn })} />
          </div>
        )}

        {/* #127 · the trip's own dates on the one RangePicker — no band: the
            pick IS the trip span. */}
        <div className="flex flex-col gap-1">
          <FieldLabel>Dates</FieldLabel>
          <RangePicker
            value={{ start: draft.startDate || null, end: draft.endDate || null }}
            onChange={(v) => set({ startDate: v.start ?? "", endDate: v.end ?? "" })}
          />
        </div>

        {/* #126 · Q5 A — "Starts from": the household default unless this trip
            overrides it. Picking a place writes the trip's own home_base*
            columns; "Use household default" clears them (reads coalesce trip →
            prefs). */}
        <div className="flex flex-col gap-1">
          <FieldLabel>
            Starts from{" "}
            {usesHousehold && (
              <span className="font-sans font-normal normal-case tracking-normal text-rv-ink-faded">
                household default
              </span>
            )}
          </FieldLabel>
          {/* The same picker, unstyled by this dialog: the rv-* names re-resolve
              under the dialog's own `.dark`, exactly as its Inputs already do. */}
          <PlacePicker
            value={draft.homeBasePlace}
            onChange={(homeBasePlace) => set({ homeBasePlace })}
          />
          {!trip.homeBaseFromHousehold && trip.homeBase !== null && draft.homeBasePlace !== null && (
            <button
              type="button"
              onClick={() => set({ homeBasePlace: null })}
              className="cursor-pointer self-start border-none bg-transparent p-0 text-[11.5px] font-semibold text-rv-ink-muted underline"
            >
              Use household default
            </button>
          )}
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
            {orphanedDestinationsMessage(orphans)}
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
 * A cascading delete's confirm — trip, chapter and destination all use THIS one, because
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
  /** the confirm button's verb: "Delete trip" · "Delete chapter" · "Delete destination" */
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
 * The destination-dates dialog — the second of the epic's two dialogs, and the medium
 * weight for a destination. Native `<input type="date">`: the app ships no date
 * picker. Unschedule sits in the footer as well as in the row menu, because
 * "these dates are wrong" and "this has no dates" are the same thought here.
 *
 * Mounted only while a destination is open so the draft is re-seeded on every open —
 * that is what makes Cancel really discard (Radix keeps the component mounted
 * and only portals its content).
 */
function DestinationDatesDialog({
  destination,
  chapterName,
  range,
  onOpenChange,
  onSave,
  onUnschedule,
}: {
  destination: Destination | null;
  chapterName: string;
  range: TripDateRange;
  onOpenChange: (open: boolean) => void;
  onSave: (destinationId: string, draft: DestinationDatesDraft, extend: DateSpan | null) => void;
  onUnschedule: (destinationId: string) => void;
}) {
  return (
    <Dialog open={destination !== null} onOpenChange={onOpenChange}>
      {destination && (
        <DestinationDatesFields
          destination={destination}
          chapterName={chapterName}
          range={range}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
          onUnschedule={onUnschedule}
        />
      )}
    </Dialog>
  );
}

function DestinationDatesFields({
  destination,
  chapterName,
  range,
  onCancel,
  onSave,
  onUnschedule,
}: {
  destination: Destination;
  chapterName: string;
  range: TripDateRange;
  onCancel: () => void;
  onSave: (destinationId: string, draft: DestinationDatesDraft, extend: DateSpan | null) => void;
  onUnschedule: (destinationId: string) => void;
}) {
  const [draft, setDraft] = useState<DestinationDatesDraft>(() => destinationDatesDraft(destination));
  const set = (patch: Partial<DestinationDatesDraft>) => setDraft((d) => ({ ...d, ...patch }));
  /** #127 · Q7 B — "Extend trip" pressed: the trip's dates move in the same save. */
  const [extend, setExtend] = useState<DateSpan | null>(null);
  const help = destinationDatesHelp(draft);
  const patch = destinationDatesPatch(destination, draft);
  // A destination dated outside the trip still needs the trip moved with it: the
  // handler's 409 stands (deriveDays clamps to the window, so the destination would
  // sit nowhere on the calendar). The picker's amber "Extend trip" is the way
  // through; without it the server's own sentence says why Save is off.
  const tripWindow = extend ? { startDate: extend.start, endDate: extend.end } : range;
  const outside =
    patch !== null &&
    destinationDatesOutsideTrip(tripWindow, {
      arriveDate: draft.arriveDate,
      departDate: draft.departDate,
    });

  return (
    <DialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[470px]">
      <DialogHeader className="gap-1.5">
        <DialogTitle className="text-[17px] font-extrabold text-rv-ink">
          Dates for {destination.place.name}
        </DialogTitle>
        <DialogDescription className="text-[11.5px] text-rv-ink-faded">{chapterName}</DialogDescription>
      </DialogHeader>

      <div className="mt-3 flex flex-col gap-2.5">
        <RangePicker
          value={{ start: draft.arriveDate || null, end: draft.departDate || null }}
          tripSpan={extend ?? { start: range.startDate, end: range.endDate }}
          onChange={(v) => set({ arriveDate: v.start ?? "", departDate: v.end ?? "" })}
          onExtendTrip={setExtend}
        />
        {extend && (
          <span className="font-mono text-[11px] text-rv-warning">
            The trip moves to {fullRange(extend.start, extend.end)} when you save.
          </span>
        )}
        {help ? (
          <span className="text-[11.5px] text-rv-ink-faded">{help}</span>
        ) : (
          <p className="m-0 rounded-rv-md bg-rv-warning-soft px-[11px] py-[9px] text-[12.5px] text-rv-warning">
            Pick an arrival and a departure — the departure can’t come first.
          </p>
        )}
        {outside && (
          <p className="m-0 rounded-rv-md bg-rv-warning-soft px-[11px] py-[9px] text-[12.5px] text-rv-warning">
            {destinationOutsideTripMessage(range, draft.arriveDate, draft.departDate)}
          </p>
        )}
      </div>

      <div className="mt-[15px] flex items-center gap-[9px]">
        <button
          type="button"
          onClick={() => onSave(destination.id, draft, extend)}
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
          onClick={() => onUnschedule(destination.id)}
          disabled={!isScheduled(destination)}
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
 * same two-part form the destination sheet's "Add idea" already is.
 *
 * It is a draft, not an idea: dismissing it writes nothing, exactly the way the
 * draft-destination row works (#60). The heading says which of the three branches you
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
