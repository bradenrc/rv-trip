"use client";

import { useState } from "react";
import { CircleMinus, RefreshCw } from "lucide-react";
import {
  JOURNAL_AROUND_HEADING,
  JOURNAL_EMPTY_COPY,
  againBadge,
  didntGetToLabel,
  journalIsEmpty,
  journalTallyParts,
  travelFoldLabel,
  tripJournal,
  type JournalEntry,
  type Trip,
} from "@rv-trip/core";
import { CategoryTile, Stars } from "@rv-trip/ui";
import { dateRange } from "@/lib/trip-logic";

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
  onRateTrip,
  onNoteTrip,
}: {
  trip: Trip;
  onRateTrip: (n: number) => void;
  onNoteTrip: (note: string) => void;
}) {
  const j = tripJournal(trip);
  const [note, setNote] = useState(trip.note ?? "");
  const [open, setOpen] = useState<{ skipped: boolean; travel: boolean }>({ skipped: false, travel: false });

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-2.5">
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
            <div className="flex items-baseline justify-between gap-2 px-0.5 pt-1">
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
            </div>
            {g.entries.length > 0 && <JournalRows entries={g.entries} />}
          </div>
        ))}
        {j.around.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="px-0.5 pt-1">
              <b className="text-[15px] text-rv-ink">{JOURNAL_AROUND_HEADING}</b>
            </div>
            <JournalRows entries={j.around} />
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
    </div>
  );
}

function JournalRows({ entries }: { entries: JournalEntry[] }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-rv-card border border-rv-border bg-rv-surface">
      {entries.map((e) => (
        <div
          key={`${e.kind}:${e.id}`}
          className="flex items-start gap-[9px] border-t border-rv-border-soft px-2.5 py-2 first:border-t-0"
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
        </div>
      ))}
    </div>
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
