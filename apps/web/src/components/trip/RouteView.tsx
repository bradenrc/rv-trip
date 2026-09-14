"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Pin,
  GripVertical,
  CalendarDays,
  Caravan,
  Navigation,
  ChevronDown,
  TriangleAlert,
  Plus,
  CirclePlus,
  Calendar,
  CircleAlert,
  MapPin,
  Pencil,
  ArrowUp,
  ArrowDown,
  ArrowLeftRight,
  Undo2,
  Trash2,
  CircleDot,
  LocateFixed,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  LOCATE_MAX_ROWS,
  PICKED_COORDLESS_LABEL,
  convertMiles,
  distanceUnitLabel,
  hasCoords,
  nearLabel,
  nearOf,
  pickedFromPlace,
  type NearPlace,
  type PickedPlace,
  type Place,
  type Units,
} from "@rv-trip/core";
import {
  EstimateChip,
  FloatingTag,
  Stars,
  ReservationLineItem,
  IdeaLineItem,
  RouteNotice,
  money,
} from "@rv-trip/ui";
import { navigationCaption, navigationOptions } from "@/lib/trip-logic";
import type { RouteDrive, RouteLeg, RouteSummary } from "@/lib/trip-logic";
import { InlineText } from "@/components/ui/inline-text";
import { PlacePicker } from "@/components/places/PlacePicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MenuHint,
  RowMenu,
  MENU_ITEM,
  MENU_ITEM_WARN,
  MENU_SURFACE,
} from "./row-menu";

/**
 * Every structural verb in the route lens lives on a row menu (⋯) — the leg
 * header's and the stop row's. Rename is the ONE exception: it is the same
 * inline edit the row already shows, and the menu item only focuses it, so a
 * name has one save path rather than two.
 */
export interface RouteViewActions {
  /** the leg or stop whose inline rename should be open (a menu Rename, or a
   * row that was just created) — `null` when nothing is being renamed */
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onRenameDone: () => void;
  onRenameLeg: (legId: string, title: string) => void;
  onAddStop: (legId: string) => void;
  onAddLeg: () => void;
  /** delta is -1 (up) / +1 (down); `canMoveLeg` disables the end of the list */
  onMoveLeg: (legId: string, delta: -1 | 1) => void;
  canMoveLeg: (legId: string, delta: -1 | 1) => boolean;
  onDeleteLeg: (legId: string) => void;
  onRenameStop: (stopId: string, name: string) => void;
  onEditStopDates: (stopId: string) => void;
  onUnscheduleStop: (stopId: string) => void;
  onMoveStopToLeg: (stopId: string, legId: string) => void;
  onDeleteStop: (stopId: string) => void;

  // ── #60 · the picker, mounted in the row ─────────────────────────────────

  /** The leg whose "Add stop" draft row is open, or null. The draft row is NOT
   * a stop: nothing is written until a place is chosen, so dismissing it
   * persists nothing — which is the only way this screen stops manufacturing
   * the coordless rows it exists to repair. */
  draftLegId: string | null;
  onPickDraftStop: (legId: string, picked: PickedPlace) => void;
  onCancelDraftStop: () => void;
  /** The stop whose place editor is open. One editor, three entry points: the
   * row menu's "Change place…", the coordless chip's "Set place", and the stop
   * sheet's mini-map button. */
  placingStopId: string | null;
  onStartChangePlace: (stopId: string) => void;
  onChangeStopPlace: (stopId: string, picked: PickedPlace) => void;
  onCancelChangePlace: () => void;
  /** The rail's Locate — one bounded batch over `summary.unmappedStops`. */
  locating: boolean;
  onLocate: () => void;
}

export function RouteView({
  legs,
  summary,
  homeBasePlace,
  costs,
  hasRig,
  units,
  onOpenStop,
  routeDrag,
  onRowDragStart,
  onRowDragEnd,
  onRowDrop,
  actions,
}: {
  legs: RouteLeg[];
  summary: RouteSummary;
  /** The trip's home base as a real place (#60 Q4 → B). It is the search bias
   * for the FIRST stop of a leg — the one row with nothing above it. */
  homeBasePlace: Place | null;
  costs: boolean;
  /** The account's display units, resolved on the server and handed down
   * through `TripPlanner`. The rail's hero converts here, at the last moment;
   * each drive row's label was already worded in these units by core's
   * `driveLabel` — one screen, one vocabulary. */
  units: Units;
  /** No rig yet = no routing input: every drive falls to a straight-line
   * estimate and the rail carries one dashed nudge. Never a blocking wizard. */
  hasRig: boolean;
  onOpenStop: (id: string) => void;
  routeDrag: { legId: string; stopId: string } | null;
  onRowDragStart: (legId: string, stopId: string) => void;
  onRowDragEnd: () => void;
  onRowDrop: (legId: string, targetId: string) => void;
  actions: RouteViewActions;
}) {
  return (
    <div className="flex flex-wrap items-start gap-8">
      {/* Reading column */}
      <div className="min-w-0 flex-1 basis-[520px] [max-width:760px]">
        <p className="m-0 mb-6 max-w-[60ch] text-[15px] text-rv-ink-muted">
          Lay out the places and take it as you go — dates are optional. Drag to reorder; drives
          are shown between any two places, dated or not.
        </p>

        {legs.map((leg) => (
          <div key={leg.id} id={`route-${leg.id}`} className="mb-8 scroll-mt-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-[3px] font-mono text-[9px] uppercase tracking-[0.12em] text-rv-ink-faded">
                  {leg.kicker}
                </div>
                <h2 className="m-0 text-[22px] font-extrabold text-rv-ink">
                  <InlineText
                    key={actions.renamingId === leg.id ? "editing" : "idle"}
                    autoEdit={actions.renamingId === leg.id}
                    onEditEnd={actions.onRenameDone}
                    value={leg.name}
                    onSave={(title) => actions.onRenameLeg(leg.id, title)}
                    label="Rename leg"
                    className="text-[22px] font-extrabold text-rv-ink"
                  />
                </h2>
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => actions.onAddStop(leg.id)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border border-rv-green bg-rv-green-soft px-[13px] py-1.5 text-[13px] font-semibold text-rv-green"
                >
                  <Plus className="size-3.5" />
                  Add stop
                </button>
                <RowMenu label={`Actions for ${leg.name}`}>
                  <DropdownMenuItem
                    className={MENU_ITEM}
                    onSelect={() => actions.onStartRename(leg.id)}
                  >
                    <Pencil />
                    Rename
                    <MenuHint>inline</MenuHint>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={MENU_ITEM}
                    disabled={!actions.canMoveLeg(leg.id, -1)}
                    onSelect={() => actions.onMoveLeg(leg.id, -1)}
                  >
                    <ArrowUp />
                    Move leg up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={MENU_ITEM}
                    disabled={!actions.canMoveLeg(leg.id, 1)}
                    onSelect={() => actions.onMoveLeg(leg.id, 1)}
                  >
                    <ArrowDown />
                    Move leg down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-0.5 my-1 bg-rv-border" />
                  <DropdownMenuItem
                    className={MENU_ITEM_WARN}
                    onSelect={() => actions.onDeleteLeg(leg.id)}
                  >
                    <Trash2 />
                    Delete leg…
                    <MenuHint>confirm</MenuHint>
                  </DropdownMenuItem>
                </RowMenu>
              </div>
            </div>

            {leg.rows.map((row, i) => {
              // The picker's bias: the stop ABOVE this one in the leg, and the
              // trip's home base when there is nothing above it.
              const near = nearOf(leg.rows[i - 1]?.stop.place, homeBasePlace);
              const placing = actions.placingStopId === row.stop.id;
              const mapped = hasCoords(row.stop.place);
              return (
              <div key={row.stop.id}>
                <div
                  // Dragging and the picker cannot share a row: a draggable
                  // ancestor swallows the text selection an input needs.
                  draggable={row.floating && !placing}
                  onDragStart={
                    row.floating && !placing
                      ? () => onRowDragStart(leg.id, row.stop.id)
                      : undefined
                  }
                  onDragEnd={row.floating && !placing ? onRowDragEnd : undefined}
                  onDragOver={row.floating && !placing ? (e) => e.preventDefault() : undefined}
                  onDrop={
                    row.floating && !placing ? () => onRowDrop(leg.id, row.stop.id) : undefined
                  }
                  className={`relative flex items-start gap-3 rounded-rv-card border bg-rv-surface p-4 shadow-rv-sm ${
                    routeDrag?.stopId === row.stop.id ? "border-rv-green" : "border-rv-border"
                  }`}
                >
                  {row.floating ? (
                    <GripVertical
                      className="relative mt-[3px] size-[18px] shrink-0 cursor-grab text-rv-ink-subtle"
                      aria-label="Drag to reorder"
                    />
                  ) : (
                    <Pin
                      className="relative mt-[3px] size-[18px] shrink-0 text-rv-ink-subtle"
                      aria-label="Ordered by date"
                    />
                  )}

                  {/* The row still opens the stop sheet, but the title line
                      now carries its own controls — so the click target is a
                      stretched overlay UNDER the content rather than a <button>
                      wrapped around it (a button inside a button is invalid,
                      and the inline rename and the ⋯ menu are both buttons).
                      Content is pointer-transparent; only the controls take
                      the pointer back. */}
                  {/* While the place editor is open the row is not a link: the
                      stretched overlay would sit over the picker's input and
                      its dropdown, and "open the sheet" is not what a click in
                      a search box means. */}
                  {!placing && (
                    <button
                      type="button"
                      onClick={() => onOpenStop(row.stop.id)}
                      aria-label={`Open ${row.stop.place.name}`}
                      className="absolute inset-0 cursor-pointer rounded-rv-card border-0 bg-transparent p-0"
                    />
                  )}
                  <div
                    className={`relative flex min-w-0 flex-1 flex-col gap-1.5 text-left ${
                      placing ? "" : "pointer-events-none"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2.5 pl-10">
                      {/* The place editor REPLACES the name: changing a place is
                          not renaming it, and the two must never be open at
                          once on one row. */}
                      {placing ? (
                        <span className="min-w-0 flex-[1_1_260px]">
                          <PlaceEditor
                            initial={pickedFromPlace(row.stop.place)}
                            near={near}
                            onPick={(p) => actions.onChangeStopPlace(row.stop.id, p)}
                            onCancel={actions.onCancelChangePlace}
                            cancelLabel={`Stop changing the place for ${row.stop.place.name}`}
                          />
                        </span>
                      ) : (
                        /* inline-block so the open editor has a block box to be
                           100% of — the masthead's <h1> gives it one for free,
                           a flex-wrap title line does not. */
                        <span className="pointer-events-auto inline-block max-w-full">
                          <InlineText
                            key={actions.renamingId === row.stop.id ? "editing" : "idle"}
                            autoEdit={actions.renamingId === row.stop.id}
                            onEditEnd={actions.onRenameDone}
                            value={row.stop.place.name}
                            onSave={(name) => actions.onRenameStop(row.stop.id, name)}
                            label="Rename stop"
                            className="text-[17px] font-bold text-rv-ink"
                          />
                        </span>
                      )}
                      {row.floating && <FloatingTag />}
                      {row.dates && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-rv-ink-faded">
                          <CalendarDays className="size-3.5" />
                          {row.dates}
                        </span>
                      )}
                      {row.rating > 0 && <Stars value={row.rating} />}
                      <span className="pointer-events-auto ml-auto">
                        <RowMenu label={`Actions for ${row.stop.place.name}`}>
                          <DropdownMenuItem
                            className={MENU_ITEM}
                            onSelect={() => actions.onStartRename(row.stop.id)}
                          >
                            <Pencil />
                            Rename
                            <MenuHint>inline</MenuHint>
                          </DropdownMenuItem>
                          {/* The same word Rename uses, because it does the same
                              thing: it opens an editor IN the row, not a dialog. */}
                          <DropdownMenuItem
                            className={MENU_ITEM}
                            onSelect={() => actions.onStartChangePlace(row.stop.id)}
                          >
                            <CircleDot />
                            Change place…
                            <MenuHint>inline</MenuHint>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={MENU_ITEM}
                            onSelect={() => actions.onEditStopDates(row.stop.id)}
                          >
                            <CalendarDays />
                            Edit dates…
                            <MenuHint>dialog</MenuHint>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={MENU_ITEM}
                            disabled={row.floating}
                            onSelect={() => actions.onUnscheduleStop(row.stop.id)}
                          >
                            <Undo2 />
                            Unschedule
                            <MenuHint>→ floating</MenuHint>
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger className={MENU_ITEM}>
                              <ArrowLeftRight />
                              Move to leg
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className={MENU_SURFACE}>
                              {legs.map((target) => (
                                <DropdownMenuItem
                                  key={target.id}
                                  className={MENU_ITEM}
                                  disabled={target.id === leg.id}
                                  onSelect={() => actions.onMoveStopToLeg(row.stop.id, target.id)}
                                >
                                  {target.name}
                                  <MenuHint>{target.kicker}</MenuHint>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator className="mx-0.5 my-1 bg-rv-border" />
                          <DropdownMenuItem
                            className={MENU_ITEM_WARN}
                            onSelect={() => actions.onDeleteStop(row.stop.id)}
                          >
                            <Trash2 />
                            Delete stop…
                            <MenuHint>confirm</MenuHint>
                          </DropdownMenuItem>
                        </RowMenu>
                      </span>
                    </div>

                    {/* A coordless stop is a LEGAL row — the escape hatch is the
                        point. What it must not be is silent: no pin, no
                        connector, no HERE route. The sentence is the picker's
                        own `PICKED_COORDLESS_LABEL`, so the row and the picker
                        can never disagree. */}
                    {!mapped && !placing && (
                      <div className="pointer-events-auto pl-10">
                        <span className="inline-flex items-center gap-[7px] rounded-rv-md border border-rv-warning bg-rv-warning-soft px-2.5 py-1 text-[12px] text-rv-warning">
                          <TriangleAlert className="size-3.5 flex-none" />
                          {PICKED_COORDLESS_LABEL}
                          <button
                            type="button"
                            onClick={() => actions.onStartChangePlace(row.stop.id)}
                            className="cursor-pointer border-none bg-transparent p-0 font-bold text-rv-warning underline"
                          >
                            Set place
                          </button>
                        </span>
                      </div>
                    )}

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
                        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-rv-ink-faded">
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
                  </div>
                </div>

                {row.drive && <Drive drive={row.drive} />}
              </div>
              );
            })}

            {/* "Add stop" appends this row and opens the picker inside it. It is
                a DRAFT, not a stop: the pick is the create, so dismissing it
                writes nothing at all. */}
            {actions.draftLegId === leg.id && (
              <div className="flex items-start gap-3 rounded-rv-card border border-dashed border-rv-border-hi bg-rv-surface p-4 shadow-rv-sm">
                <GripVertical
                  className="mt-[3px] size-[18px] shrink-0 text-rv-ink-subtle"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <PlaceEditor
                    initial={null}
                    near={nearOf(leg.rows.at(-1)?.stop.place, homeBasePlace)}
                    onPick={(p) => actions.onPickDraftStop(leg.id, p)}
                    onCancel={actions.onCancelDraftStop}
                    cancelLabel="Discard this stop"
                  />
                </div>
              </div>
            )}

            {leg.outboundDrive && (
              <>
                <div className="my-0.5 ml-8 flex items-center gap-[9px]">
                  <span className="font-mono text-[9px] uppercase tracking-[0.11em] text-rv-ink-faded">
                    {leg.outboundSeam}
                  </span>
                  <span className="h-px flex-1 bg-rv-border-soft" />
                </div>
                <Drive drive={leg.outboundDrive} />
              </>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={actions.onAddLeg}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-dashed border-rv-border-hi bg-transparent px-[18px] py-2.5 text-[14px] font-semibold text-rv-ink"
        >
          <CirclePlus className="size-4" />
          Add leg
        </button>
      </div>

      <RouteRail
        summary={summary}
        costs={costs}
        hasRig={hasRig}
        units={units}
        locating={actions.locating}
        onLocate={actions.onLocate}
      />
    </div>
  );
}

/**
 * The one inline place editor — the shipped `PlacePicker` composed unchanged,
 * plus the two things a picker mounted in a ROW needs and a picker mounted in a
 * sheet does not.
 *
 *  1. The bias line. `near` (PlacePicker.tsx:48) has always existed and has
 *     never been visible; on a row it is the difference between "search the
 *     planet" and "search near the stop above", so the row says which.
 *  2. A way out. The picker itself has no dismiss — its ✕ clears the CHOSEN
 *     place and drops back to the search box (design state 6 → 1). Abandoning
 *     the editor entirely is this button, and on a draft row it is also how you
 *     abandon the stop: nothing has been written yet.
 *
 * The value is held here rather than by the caller so that clearing the chip
 * really does drop back to the search box — a value read straight off the stop
 * would snap back on the next render.
 */
function PlaceEditor({
  initial,
  near,
  onPick,
  onCancel,
  cancelLabel,
}: {
  initial: PickedPlace | null;
  near: NearPlace | null;
  onPick: (picked: PickedPlace) => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const [value, setValue] = useState<PickedPlace | null>(initial);
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {near && (
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-rv-ink-faded">
            {nearLabel(near)}
          </div>
        )}
        <PlacePicker
          value={value}
          onChange={(picked) => {
            setValue(picked);
            if (picked) onPick(picked);
          }}
          near={near}
        />
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label={cancelLabel}
        className="mt-[3px] inline-flex flex-none cursor-pointer items-center justify-center rounded-rv-sm border border-rv-border bg-transparent p-1 text-rv-ink-faded"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * A drive has exactly three renderings, and only one of them is amber.
 *
 *  1. routed + clean      → one mono line (what the connector has always been)
 *  2. routed + restricted → a bordered card, one amber notice row per notice
 *  3. un-routed           → the same one line, `~` kept, neutral "estimate" chip
 *
 * There is no fourth state: a drive we cannot route is a missing value, never a
 * spinner and never a blocked save. A pair with no coordinates yields no
 * connector at all — it never reaches here.
 *
 * Navigate is the same plain Google link in all three: origin and destination,
 * never the corridor. What changed in #36 is the ANSWER about that link — the
 * control is a split button whose caret offers HERE WeGo, and in state 2 the
 * caption is green when the corridor check passed and the shipped amber string
 * when it did not.
 */
function Drive({ drive }: { drive: RouteDrive }) {
  if (drive.notices.length === 0) {
    return (
      <div className="my-1 ml-8 flex flex-wrap items-center gap-[9px] py-[5px] font-mono text-[12px] text-rv-ink-faded">
        <Caravan className="size-4 text-rv-ink" />
        <span className="text-rv-ink-muted">{drive.label}</span>
        {drive.primaryRoad && (
          <>
            <span aria-hidden>·</span>
            <span>{drive.primaryRoad}</span>
          </>
        )}
        {drive.estimate && <EstimateChip />}
        <NavigateButton drive={drive} className="ml-2" />
      </div>
    );
  }

  return (
    <div className="my-1 ml-8">
      <div className="rounded-rv-md border border-l-[3px] border-rv-border border-l-rv-travel bg-rv-surface px-[13px] pb-[11px] pt-2.5 shadow-rv-sm">
        <div className="flex flex-wrap items-center gap-[9px]">
          <Caravan className="size-4 text-rv-ink" />
          <span className="font-mono text-[12px] text-rv-ink-muted">{drive.label}</span>
          {drive.primaryRoad && (
            <span className="font-mono text-[12px] text-rv-ink-faded">· {drive.primaryRoad}</span>
          )}
          {drive.estimate && <EstimateChip />}
          <NavigateButton drive={drive} className="ml-auto" />
        </div>
        {/* The caveat belongs ON the action. The handoff is still origin and
            destination only — Google's URL scheme has no pass-through waypoint
            — so this line says whether that link was HELD AGAINST the corridor
            HERE cleared for the rig. Green when it was and matched, and
            otherwise the shipped amber string, character for character. Plain
            text rather than a bordered row either way: a caption on a button,
            not a second error. */}
        <DriveCaption drive={drive} />
        {/* One row per notice, unbounded — no truncation. The notices do NOT
            dismiss on handoff — they are the thing you can still read at the
            next fuel stop, and the only place your clearance is written down. */}
        <div className="mt-2 flex flex-col gap-2">
          {drive.notices.map((notice, i) => (
            <RouteNotice key={`${notice.code}-${i}`} message={notice.message} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The caption under a restricted drive's Navigate. Both strings and the tone
 * come from `navigationCaption` in @rv-trip/core — the only place a test runner
 * in this repo can reach them (apps/web's vitest has no DOM).
 */
function DriveCaption({ drive }: { drive: RouteDrive }) {
  const caption = navigationCaption(drive);
  return (
    <div
      className={`mt-[7px] text-right text-[11.5px] ${
        caption.tone === "checked" ? "text-rv-green" : "text-rv-warning"
      }`}
    >
      {caption.text}
    </div>
  );
}

/** The pill both halves of the split control sit in. Its accent fill and its
 * ink are on ONE source line, because nightfall-tokens.test.ts sweeps that pair
 * per call site. */
const NAV_PILL =
  "inline-flex min-h-8 items-center whitespace-nowrap rounded-rv-md bg-rv-accent-deep text-rv-accent-ink shadow-rv-sm";

/**
 * The slice's primary action, and one you press at a fuel stop with the engine
 * running — so it carries a 32px floor (`min-h-8`) on top of the design's
 * padding, on the pill, the body AND the caret. Type, colour and padding are
 * the wireframe's; the floor only stops the box shrinking under the touch
 * target.
 *
 * ONE control, split: the body takes the verdict's primary handoff and the
 * caret opens the two, on the shipped `dropdown-menu` primitive and the shipped
 * menu classes (`MENU_SURFACE` / `MENU_ITEM` from ./row-menu — the row menu's
 * own surface, so the four menus in this app stay one object). The active row
 * carries the wireframe's `.mi.on` tint.
 */
function NavigateButton({ drive, className }: { drive: RouteDrive; className: string }) {
  const options = navigationOptions(drive);
  const [primary] = options;
  return (
    <div className={`${NAV_PILL} ${className}`}>
      <a
        href={primary!.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-8 items-center gap-1.5 px-3 py-[5px] text-[13px] font-bold no-underline"
      >
        <Navigation className="size-3.5" />
        Navigate
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Choose a navigation app"
          className="inline-flex min-h-8 cursor-pointer items-center border-l border-l-rv-accent-ink pl-2 pr-2.5 opacity-55"
        >
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={MENU_SURFACE}>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.id}
              asChild
              className={`${MENU_ITEM} items-start ${
                option.primary ? "bg-rv-green-soft" : ""
              }`}
            >
              <a href={option.url} target="_blank" rel="noreferrer" className="no-underline">
                <span className="flex flex-col gap-0.5">
                  <span
                    className={`font-bold ${option.primary ? "text-rv-green-ink" : "text-rv-ink"}`}
                  >
                    {option.title}
                  </span>
                  <span className="whitespace-normal font-mono text-[9.5px] text-rv-ink-faded">
                    {option.caption}
                  </span>
                </span>
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Stat({ Icon, label, value, warn }: { Icon: LucideIcon; label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`mt-px size-[15px] ${warn ? "text-rv-warning" : "text-rv-green"}`} />
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-rv-ink-faded">{label}</div>
        <div className="text-[13px] font-semibold text-rv-ink-muted">{value}</div>
      </div>
    </div>
  );
}

const kicker = "font-mono text-[11px] uppercase tracking-[0.1em] text-rv-ink-faded";

/** One press geocodes at most `LOCATE_MAX_ROWS` rows — the same ceiling /map's
 * button slices to, so the running label never promises a batch bigger than the
 * one the route will accept. */
function locateBatchSize(summary: RouteSummary): number {
  return Math.min(summary.unmapped, LOCATE_MAX_ROWS);
}

function RouteRail({
  summary,
  costs,
  hasRig,
  units,
  locating,
  onLocate,
}: {
  summary: RouteSummary;
  costs: boolean;
  hasRig: boolean;
  units: Units;
  locating: boolean;
  onLocate: () => void;
}) {
  return (
    <aside className="w-full md:w-[260px] md:flex-none">
      <div className="sticky top-6 flex flex-col gap-[18px] rounded-rv-card border border-rv-border bg-rv-surface p-[18px] shadow-rv-sm">
        {/* Driving hero */}
        <div>
          <div className={`${kicker} mb-2`}>On the road</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[34px] font-bold leading-none text-rv-ink">
              {summary.driveMiles > 0 ? convertMiles(summary.driveMiles, units) : "—"}
            </span>
            {summary.driveMiles > 0 && (
              <span className="font-mono text-[15px] font-semibold text-rv-ink-faded">
                {distanceUnitLabel(units)}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-rv-ink-faded">
            {summary.driveMiles > 0
              ? `${summary.driveTime} behind the wheel`
              : "add stops with places to estimate driving"}
          </div>

          {/* Only when there is something to say — a permanent "0 restrictions"
              would train the eye to skip the slot. */}
          {summary.restrictionCount > 0 && (
            <div className="mt-2 inline-flex items-center gap-[7px] rounded-rv-md border border-rv-warning bg-rv-warning-soft px-[9px] py-[5px] text-[12px] text-rv-warning">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span>
                {summary.restrictionCount} restriction{summary.restrictionCount === 1 ? "" : "s"} on
                this route
              </span>
            </div>
          )}

          {/* The rig is the only thing standing between an estimate and a real
              route, so the ask belongs exactly where the estimate is showing. */}
          {!hasRig && summary.driveMiles > 0 && (
            <div className="mt-3 rounded-rv-md border border-dashed border-rv-border-hi px-[11px] py-2.5">
              <div className="text-[12.5px] text-rv-ink-muted">
                Drive times are straight-line estimates until you tell us about your rig.
              </div>
              <Link
                href="/rig"
                className="mt-1.5 inline-block text-[12.5px] font-bold text-rv-accent no-underline"
              >
                Set up your rig →
              </Link>
            </div>
          )}
        </div>

        {/* Planned cost — only when tracking */}
        {costs && (
          <div className="border-t border-rv-border-soft pt-3.5">
            <div className={`${kicker} mb-2`}>Planned cost</div>
            <div className="font-mono text-[26px] font-bold leading-none text-rv-accent">
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

          {/* Only when there is something to say — the same rule
              `restrictionCount` follows above. The planner speaks in amber here
              where /map's unmapped count is a neutral dashed chip, and that is
              deliberate: /map is a browse surface where an unmapped row costs
              nothing, and this is where the consequence lives (no connector, no
              drive time, no route). See docs/design/60. */}
          {summary.unmapped > 0 && (
            <>
              <div className="flex items-start gap-2 text-[12.5px] text-rv-warning">
                <TriangleAlert className="mt-px size-[15px] flex-none" />
                <span>
                  {summary.unmapped} stop{summary.unmapped === 1 ? "" : "s"} without a place
                </span>
              </div>
              <button
                type="button"
                onClick={onLocate}
                disabled={locating}
                className={`inline-flex items-center gap-1.5 self-start rounded-rv-pill border border-rv-warning bg-rv-warning-soft px-3 py-1 text-[12px] font-semibold text-rv-warning ${
                  locating ? "cursor-default opacity-60" : "cursor-pointer"
                }`}
              >
                <LocateFixed className="size-3.5" />
                {locating
                  ? `Looking up ${locateBatchSize(summary)} ${
                      locateBatchSize(summary) === 1 ? "place" : "places"
                    }…`
                  : "Locate"}
              </button>
            </>
          )}
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
                <span className="text-[13px] font-semibold text-rv-ink">{l.name}</span>
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
