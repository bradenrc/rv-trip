"use client";

import {
  nextTimeDatesLine,
  nextTimeKicker,
  nextTimeRowAction,
  type ForNextTime,
  type NextTimeCard,
  type NextTimeRow,
} from "@rv-trip/core";
import { CategoryTile, Stars } from "@rv-trip/ui";
import { AgainBadge } from "./JournalLens";

/**
 * "Last time here" (#113 · #107, Q7 B · Q8 B · docs/design/113 Screen 4):
 * one card per past trip × destination this trip goes back near, drawn above
 * the lenses next to W1's nearby banner. The numbers are core's `forNextTime`,
 * computed on the server (trips/[id]/page.tsx); the card's saves are already
 * left out of the banner's count.
 *
 * No card is the empty state: nothing renders.
 */
export function LastTimeHere({
  nextTime,
  onAdd,
}: {
  nextTime: ForNextTime;
  onAdd: (row: NextTimeRow) => void;
}) {
  if (nextTime.cards.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-3">
      {nextTime.cards.map((card) => (
        <Card key={`${card.pastTrip.id}:${card.destination.id ?? card.stop.id}`} card={card} onAdd={onAdd} />
      ))}
    </div>
  );
}

function Card({ card, onAdd }: { card: NextTimeCard; onAdd: (row: NextTimeRow) => void }) {
  return (
    <div className="overflow-hidden rounded-rv-card border border-rv-border-hi bg-rv-surface shadow-rv-md">
      <div className="border-b border-rv-border-soft px-[11px] pb-2 pt-[9px]">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-rv-ink-muted">{nextTimeKicker(card)}</div>
        <div className="flex items-baseline justify-between gap-1.5">
          <b className="text-[13.5px] text-rv-ink">{card.pastTrip.title}</b>
          {card.pastTrip.rating !== null && <Stars value={card.pastTrip.rating} size={13} />}
        </div>
        <div className="font-mono text-[11px] text-rv-ink-faded">{nextTimeDatesLine(card)}</div>
        {card.pastTrip.note && (
          <div className="mt-[3px] text-[12.5px] italic text-rv-ink-muted">“{card.pastTrip.note}”</div>
        )}
      </div>
      {card.again.map((row) => (
        <Row key={row.saveId} row={row} group="again" onAdd={onAdd} />
      ))}
      {card.once.map((row) => (
        <Row key={row.saveId} row={row} group="once" onAdd={onAdd} />
      ))}
    </div>
  );
}

function Row({
  row,
  group,
  onAdd,
}: {
  row: NextTimeRow;
  group: "again" | "once";
  onAdd: (row: NextTimeRow) => void;
}) {
  const action = nextTimeRowAction(row, group);
  return (
    <div className="flex items-start gap-[9px] border-t border-rv-border-soft px-2.5 py-2">
      <CategoryTile type={row.type} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold leading-[1.3] text-rv-ink">{row.name}</div>
        {(row.rating !== null || row.again !== null) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {row.rating !== null && <Stars value={row.rating} size={13} />}
            <AgainBadge again={row.again} />
          </div>
        )}
        {row.note && <div className="mt-0.5 text-[13px] leading-[1.35] text-rv-ink-muted">{row.note}</div>}
      </div>
      {action === "Add" ? (
        <button
          type="button"
          onClick={() => onAdd(row)}
          // Navy ink on the green fill — the conventions' one pairing for it
          // (green-cta is stay-text only on the web).
          className="flex-none cursor-pointer self-center rounded-rv-md border-none bg-rv-green px-2 py-1 text-[10.5px] font-extrabold text-rv-navy"
        >
          Add
        </button>
      ) : action ? (
        <span className="flex-none self-center rounded-rv-md border border-rv-green bg-transparent px-2 py-1 text-[10.5px] font-extrabold text-rv-green-ink">
          {action}
        </span>
      ) : null}
    </div>
  );
}
