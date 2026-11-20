"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleMinus, RefreshCw } from "lucide-react";
import {
  JOURNAL_AROUND_HEADING,
  JOURNAL_EMPTY_COPY,
  activeTrip,
  againBadge,
  journalToday,
  upNext,
  upNextThenLine,
  didntGetToLabel,
  journalIsEmpty,
  journalTallyParts,
  saveForJournalEntry,
  travelFoldLabel,
  tripJournal,
  type IsoDate,
  type JournalEntry,
  type RouteDrive,
  type SavedPlace,
  type Trip,
} from "@rv-trip/core";
import { CategoryTile, Stars } from "@rv-trip/ui";
import { dateRange } from "@/lib/trip-logic";
import { JournalMap } from "./JournalMap";
import { NavigateLinks, RvRouteLine } from "./NavigateLinks";

/**
 * The web's Journal lens (#113 · #106, Q4 B · docs/design/113 Screen 3, the
 * desk frame). One core read — `tripJournal(trip)` — so this and the phone's
 * Journal can't disagree.
 *
 * Read-only apart from the trip card: per-thing check-off is the phone's job.
 * The trip card is the existing `trips.rating` / `trips.note` pair the
 * dashboard's Traveled cards show, edited in place and saved through
 * `PATCH /api/trips/:id` by the planner's handlers.
 */
export function JournalLens({
  trip,
  today,
  now,
  drives,
  onRateTrip,
  onNoteTrip,
  saves = NO_SAVES,
}: {
  trip: Trip;
  /** #197 · #196: the owner's library — an entry whose name is in it gets a ›
   * to its Place view (core's `saveForJournalEntry`, the phone's rule). */
  saves?: readonly SavedPlace[];
  /** The browser's date (the `tz` cookie); null when the server cannot know it. */
  today: IsoDate | null;
  /** The request's instant (ISO) — Up next's clock until the first tick. */
  now: string;
  /** The route's drives by segment (core's `routeDrives`). */
  drives: ReadonlyMap<string, RouteDrive>;
  onRateTrip: (n: number) => void;
  onNoteTrip: (note: string) => void;
}) {
  // #178 · Up next moves with the clock: the server's instant first (so the
  // first paint matches), then the browser's, re-read once a minute.
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toISOString()), 60_000);
    return () => clearInterval(t);
  }, []);
  // #178 · q5 A — the whole-trip form, swapped in place for this visit only.
  const [whole, setWhole] = useState(false);
  const midTrip = today !== null && activeTrip([trip], today) !== null;
  // #179 · two-way selection: a row or a group heading lights its pin, and a
  // pin lights its row or heading.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sel = { selectedId, onSelect: setSelectedId };

  // #179 · q6 A — one layout for both forms: the list on the left, the map
  // always beside it (stacked above it below md). No map for an empty journal.
  return (
    <SavesContext.Provider value={saves}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(300px,420px)_1fr]">
        <div className="flex min-w-0 flex-col gap-2">
          {midTrip && !whole ? (
            <JournalTodayLens
              trip={trip}
              today={today}
              clock={clock}
              drives={drives}
              onWhole={() => setWhole(true)}
              {...sel}
            />
          ) : (
            <WholeTripLens
              trip={trip}
              onRateTrip={onRateTrip}
              onNoteTrip={onNoteTrip}
              onToday={midTrip ? () => setWhole(false) : null}
              {...sel}
            />
          )}
        </div>
        {!journalIsEmpty(tripJournal(trip)) && (
          <JournalMap
            trip={trip}
            today={today}
            label={midTrip ? "The trip so far" : "Everything logged on this trip"}
            selectedId={selectedId}
            onSelect={setSelectedId}
            saves={saves}
          />
        )}
      </div>
    </SavesContext.Provider>
  );
}

const NO_SAVES: readonly SavedPlace[] = [];
/** The library, for every JournalRows under this lens without threading it
 * through both forms' props. */
const SavesContext = createContext<readonly SavedPlace[]>(NO_SAVES);

/** The selection both forms share with the map. */
interface Selection {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The wireframe's `.row.sel` / `.sect.sel`: navy-soft with an ink bar. */
const SELECTED = "bg-rv-navy-soft shadow-[inset_3px_0_0_var(--color-rv-ink)]";

/**
 * #178 · #181 i4 (q3 B · q4 B · q8 A, docs/design/181 frame 5) — the mid-trip
 * Journal: Up next (`upNext`), Today and Earlier (`journalToday`) and the green
 * Log something, which asks Nav to open its CaptureSheet (`rv:capture`). Still
 * read-only: no "How was it?" here — that is the phone's.
 */
function JournalTodayLens({
  trip,
  today,
  clock,
  drives,
  onWhole,
  selectedId,
  onSelect,
}: {
  trip: Trip;
  today: IsoDate;
  clock: string;
  drives: ReadonlyMap<string, RouteDrive>;
  onWhole: () => void;
} & Selection) {
  const up = upNext(trip, new Date(clock), today);
  const j = journalToday(trip, today);
  const names = new Map(trip.chapters.flatMap((c) => c.destinations).map((d) => [d.id, d.place.name] as const));
  const nextDrive = up?.next.navTo ? (drives.get(up.next.segmentId ?? "") ?? null) : null;
  // Only a drive's segment is in `drives`, so a fly or ferry "then" gets no Navigate.
  const thenDrive = up?.then ? (drives.get(up.then.segmentId ?? "") ?? null) : null;
  const earlier = j.earlier.filter((g) => g.entries.length > 0 || g.rating !== null || g.again !== null);
  const sect = "px-0.5 pt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-rv-ink-faded";

  return (
    <>
      {up && (
        <>
          <div className={sect}>Up next</div>
          <div className="flex flex-col gap-2 rounded-rv-card border border-rv-border-hi bg-rv-surface px-3 py-2.5 shadow-rv-sm">
            <div className="flex items-baseline gap-2">
              <b className="flex-1 text-[15px] leading-[1.3] text-rv-ink">{up.next.title}</b>
              <span className="whitespace-nowrap font-mono text-[11px] uppercase text-rv-ink-muted">{up.next.when}</span>
            </div>
            {nextDrive && (
              <div>
                <NavigateLinks drive={nextDrive} toName={names.get(nextDrive.toDestinationId) ?? ""} />
                <RvRouteLine drive={nextDrive} rigOn={trip.rigOn} fromName={names.get(nextDrive.fromDestinationId) ?? ""} />
              </div>
            )}
            {up.then && (
              <div className="border-t border-rv-border-soft pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-rv-ink-faded">
                {upNextThenLine(up.then)}
              </div>
            )}
            {thenDrive && (
              <div>
                <NavigateLinks drive={thenDrive} toName={names.get(thenDrive.toDestinationId) ?? ""} />
                <RvRouteLine drive={thenDrive} rigOn={trip.rigOn} fromName={names.get(thenDrive.fromDestinationId) ?? ""} />
              </div>
            )}
          </div>
        </>
      )}
      <GroupHead
        id={j.today.destination?.id ?? null}
        className={`${sect} rounded-rv-sm font-bold text-rv-ink`}
        selectedId={selectedId}
        onSelect={onSelect}
      >
        {j.today.heading}
      </GroupHead>
      {j.today.entries.length > 0 ? (
        <JournalRows entries={j.today.entries} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <div className="rounded-rv-card border border-rv-border bg-rv-surface px-2.5 py-2 text-[13px] text-rv-ink-faded">
          Nothing logged here yet.
        </div>
      )}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("rv:capture"))}
        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-rv-card border-none bg-rv-green p-3 text-[15px] font-extrabold text-rv-navy"
      >
        ＋ Log something
      </button>
      {earlier.length > 0 && <div className={sect}>Earlier</div>}
      {earlier.map((g) => (
        <div key={g.destination?.id ?? "around"} className="flex flex-col gap-2">
          <GroupHead
            id={g.destination?.id ?? null}
            className="flex items-baseline justify-between gap-2 rounded-rv-sm px-0.5 pt-1"
            selectedId={selectedId}
            onSelect={onSelect}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <b className="text-[15px] text-rv-ink">{g.heading}</b>
              {g.rating !== null && <Stars value={g.rating} size={13} />}
              <AgainBadge again={g.again} />
            </span>
            {g.destination?.arriveDate && g.destination.departDate && (
              <span className="flex-none font-mono text-[11px] text-rv-ink-faded">
                {dateRange(g.destination.arriveDate, g.destination.departDate)}
              </span>
            )}
          </GroupHead>
          {g.entries.length > 0 && <JournalRows entries={g.entries} selectedId={selectedId} onSelect={onSelect} />}
        </div>
      ))}
      <button
        type="button"
        onClick={onWhole}
        className="cursor-pointer border-none bg-transparent p-1.5 text-center text-[13px] font-bold text-rv-green-ink underline"
      >
        Whole trip and map →
      </button>
    </>
  );
}

/** The shipped whole-trip Journal; mid-trip it opens with "‹ Today". */
function WholeTripLens({
  trip,
  onRateTrip,
  onNoteTrip,
  onToday,
  selectedId,
  onSelect,
}: {
  trip: Trip;
  onRateTrip: (n: number) => void;
  onNoteTrip: (note: string) => void;
  onToday: (() => void) | null;
} & Selection) {
  const j = tripJournal(trip);
  const [note, setNote] = useState(trip.note ?? "");
  const [open, setOpen] = useState<{ skipped: boolean; travel: boolean }>({ skipped: false, travel: false });

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {onToday && (
          <button
            type="button"
            onClick={onToday}
            className="cursor-pointer self-start border-none bg-transparent p-0 text-left text-[13px] font-bold text-rv-green-ink underline"
          >
            ‹ Today
          </button>
        )}
        <div className="rounded-rv-card border border-rv-border bg-rv-surface p-3.5 shadow-rv-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-rv-ink-faded">The trip</span>
            <Stars value={trip.rating ?? 0} size={13} onSet={onRateTrip} />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== (trip.note ?? "")) onNoteTrip(note);
            }}
            rows={2}
            aria-label="The trip's note"
            placeholder="What to remember for next time…"
            className="mt-2 w-full resize-none rounded-rv-md border border-rv-border-hi bg-rv-surface-alt px-2.5 py-2 text-[13px] text-rv-ink placeholder:text-rv-ink-faded"
          />
        </div>
        {!journalIsEmpty(j) && (
          <div className="flex flex-wrap gap-2.5 font-mono text-[11px] text-rv-ink-faded">
            {journalTallyParts(j.tally).map((p) => (
              <span key={p.label}>
                <b className="text-rv-ink">{p.n}</b> {p.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {journalIsEmpty(j) && <p className="m-0 text-[13px] text-rv-ink-faded">{JOURNAL_EMPTY_COPY}</p>}
        {j.destinations.map((g) => (
          <div key={g.destination.id} className="flex flex-col gap-2">
            <GroupHead
              id={g.destination.id}
              className="flex items-baseline justify-between gap-2 rounded-rv-sm px-0.5 pt-1"
              selectedId={selectedId}
              onSelect={onSelect}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <b className="text-[15px] text-rv-ink">{g.destination.place.name}</b>
                {g.rating !== null && <Stars value={g.rating} size={13} />}
                <AgainBadge again={g.again} />
              </span>
              {g.destination.arriveDate && g.destination.departDate && (
                <span className="flex-none font-mono text-[11px] text-rv-ink-faded">
                  {dateRange(g.destination.arriveDate, g.destination.departDate)}
                </span>
              )}
            </GroupHead>
            {g.entries.length > 0 && <JournalRows entries={g.entries} selectedId={selectedId} onSelect={onSelect} />}
          </div>
        ))}
        {j.around.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="px-0.5 pt-1">
              <b className="text-[15px] text-rv-ink">{JOURNAL_AROUND_HEADING}</b>
            </div>
            <JournalRows entries={j.around} selectedId={selectedId} onSelect={onSelect} />
          </div>
        )}
        {j.didntGetTo.length > 0 && (
          <Fold
            label={didntGetToLabel(j.didntGetTo.length)}
            items={j.didntGetTo.map((i) => i.title)}
            open={open.skipped}
            onToggle={() => setOpen((o) => ({ ...o, skipped: !o.skipped }))}
          />
        )}
        {j.travel.length > 0 && (
          <Fold
            label={travelFoldLabel(trip, j.travel)}
            items={j.travel.map((r) => r.name)}
            open={open.travel}
            onToggle={() => setOpen((o) => ({ ...o, travel: !o.travel }))}
          />
        )}
      </div>
    </>
  );
}

/**
 * A group heading. A destination's is a button that selects its disc on the
 * map (and lights when the disc is picked); "Around the trip" has no disc and
 * stays a plain heading.
 */
function GroupHead({
  id,
  className,
  selectedId,
  onSelect,
  children,
}: { id: string | null; className: string; children: ReactNode } & Selection) {
  if (id === null) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={id === selectedId}
      className={`${className} w-full cursor-pointer border-none bg-transparent text-left ${id === selectedId ? SELECTED : ""}`}
    >
      {children}
    </button>
  );
}

function JournalRows({ entries, selectedId, onSelect }: { entries: JournalEntry[] } & Selection) {
  const saves = useContext(SavesContext);
  return (
    <div className="flex flex-col overflow-hidden rounded-rv-card border border-rv-border bg-rv-surface">
      {entries.map((e) => (
        <div
          key={`${e.kind}:${e.id}`}
          // An idea row selects its pin; a reservation has no pin of its own.
          onClick={e.kind === "idea" ? () => onSelect(e.id) : undefined}
          className={`flex items-start gap-[9px] border-t border-rv-border-soft px-2.5 py-2 first:border-t-0 ${
            e.kind === "idea" ? "cursor-pointer" : ""
          } ${e.id === selectedId ? SELECTED : ""}`}
        >
          <CategoryTile type={e.type} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold leading-[1.3] text-rv-ink">{e.name}</div>
            {(e.rating !== null || e.again !== null) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {e.rating !== null && <Stars value={e.rating} size={13} />}
                <AgainBadge again={e.again} />
              </div>
            )}
            {e.notes && <div className="mt-0.5 text-[13px] leading-[1.35] text-rv-ink-muted">{e.notes}</div>}
          </div>
          <EntryOpen entry={e} saves={saves} />
        </div>
      ))}
    </div>
  );
}

/**
 * #197 · #196 · a Journal entry whose name is in the library gets a › to its
 * Place view; one that is not gets nothing. The row's own click stays the
 * shipped one (it selects the pin), so the › is its own link and does not
 * bubble into it.
 */
function EntryOpen({ entry, saves }: { entry: JournalEntry; saves: readonly SavedPlace[] }) {
  const save = saveForJournalEntry(entry, saves);
  if (!save) return null;
  return (
    <Link
      href={`/places/${save.id}`}
      aria-label={`Open ${save.place.name}`}
      onClick={(ev) => ev.stopPropagation()}
      className="flex-none self-center rounded-rv-sm px-1.5 text-[14px] leading-none text-rv-ink-faded no-underline hover:bg-rv-navy-soft"
    >
      ›
    </Link>
  );
}

/**
 * Q9 A: Again is neutral ink on rv-border-hi with the ↻ glyph; Once was
 * enough stays amber (rv-warning on rv-warning-soft). Not said: no badge.
 */
export function AgainBadge({ again }: { again: boolean | null }) {
  const b = againBadge(again);
  if (!b) return null;
  const Icon = b.once ? CircleMinus : RefreshCw;
  return (
    <span
      className={`inline-flex items-center gap-[3px] whitespace-nowrap rounded-rv-pill border px-[7px] py-px align-middle font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] ${
        b.once
          ? "border-rv-warning bg-rv-warning-soft text-rv-warning"
          : "border-rv-border-hi bg-rv-surface text-rv-ink-muted"
      }`}
    >
      <Icon className="size-[9px]" />
      {b.label}
    </span>
  );
}

/** A collapsed fold — "Didn't get to · 1: Rincón de la Vieja day trip ▸" —
 * that expands in place. */
function Fold({
  label,
  items,
  open,
  onToggle,
}: {
  label: string;
  items: string[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="cursor-pointer rounded-rv-card border border-dashed border-rv-border-hi bg-transparent px-[9px] py-1.5 text-left text-[12.5px] text-rv-ink-faded"
    >
      <b className="text-rv-ink-muted">{label}</b>
      {open ? (
        <ul className="m-0 mt-1 list-none p-0">
          {items.map((name, i) => (
            <li key={i}>{name}</li>
          ))}
        </ul>
      ) : (
        <>: {items.join(" · ")} ▸</>
      )}
    </button>
  );
}
