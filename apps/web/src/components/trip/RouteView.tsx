"use client";

import Link from "next/link";
import {
  Pin,
  GripVertical,
  CalendarDays,
  Caravan,
  Navigation,
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
  type LucideIcon,
} from "lucide-react";
import {
  EstimateChip,
  FloatingTag,
  Stars,
  ReservationLineItem,
  IdeaLineItem,
  RouteNotice,
  money,
} from "@rv-trip/ui";
import type { RouteDrive, RouteLeg, RouteSummary } from "@/lib/trip-logic";
import { InlineText } from "@/components/ui/inline-text";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
}

export function RouteView({
  legs,
  summary,
  costs,
  hasRig,
  onOpenStop,
  routeDrag,
  onRowDragStart,
  onRowDragEnd,
  onRowDrop,
  actions,
}: {
  legs: RouteLeg[];
  summary: RouteSummary;
  costs: boolean;
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

            {leg.rows.map((row) => (
              <div key={row.stop.id}>
                <div
                  draggable={row.floating}
                  onDragStart={row.floating ? () => onRowDragStart(leg.id, row.stop.id) : undefined}
                  onDragEnd={row.floating ? onRowDragEnd : undefined}
                  onDragOver={row.floating ? (e) => e.preventDefault() : undefined}
                  onDrop={row.floating ? () => onRowDrop(leg.id, row.stop.id) : undefined}
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
                  <button
                    type="button"
                    onClick={() => onOpenStop(row.stop.id)}
                    aria-label={`Open ${row.stop.place.name}`}
                    className="absolute inset-0 cursor-pointer rounded-rv-card border-0 bg-transparent p-0"
                  />
                  <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-1.5 text-left">
                    <div className="flex flex-wrap items-center gap-2.5 pl-10">
                      {/* inline-block so the open editor has a block box to be
                          100% of — the masthead's <h1> gives it one for free,
                          a flex-wrap title line does not. */}
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
            ))}

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

      <RouteRail summary={summary} costs={costs} hasRig={hasRig} />
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
 * never the corridor. In state 2 it carries an amber caption saying so.
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
        <NavigateButton href={drive.navUrl} className="ml-2" />
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
          <NavigateButton href={drive.navUrl} className="ml-auto" />
        </div>
        {/* The caveat belongs ON the action. The handoff is origin and
            destination only — Google's URL scheme has no pass-through waypoint,
            so the link is not the corridor HERE cleared for the rig. Amber
            because it is a real restriction, but plain text rather than a
            bordered row: a caption on a button, not a second error. */}
        <div className="mt-[7px] text-right text-[11.5px] text-rv-warning">
          Navigation may not follow the RV-safe route — check notices.
        </div>
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
 * The slice's primary action, and one you press at a fuel stop with the engine
 * running — so it carries a 32px floor (`min-h-8`) on top of the design's
 * padding. Type, colour and padding are the wireframe's; the floor only stops
 * the box shrinking under the touch target.
 */
function NavigateButton({ href, className }: { href: string; className: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-rv-md bg-rv-accent-deep px-3 py-[5px] text-[13px] font-bold text-rv-accent-ink no-underline shadow-rv-sm ${className}`}
    >
      <Navigation className="size-3.5" />
      Navigate
    </a>
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

function RouteRail({
  summary,
  costs,
  hasRig,
}: {
  summary: RouteSummary;
  costs: boolean;
  hasRig: boolean;
}) {
  return (
    <aside className="w-[260px] flex-none">
      <div className="sticky top-6 flex flex-col gap-[18px] rounded-rv-card border border-rv-border bg-rv-surface p-[18px] shadow-rv-sm">
        {/* Driving hero */}
        <div>
          <div className={`${kicker} mb-2`}>On the road</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[34px] font-bold leading-none text-rv-ink">
              {summary.driveMiles || "—"}
            </span>
            {summary.driveMiles > 0 && (
              <span className="font-mono text-[15px] font-semibold text-rv-ink-faded">mi</span>
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
