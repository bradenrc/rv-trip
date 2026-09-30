"use client";

import type { Reservation, SegmentBookingsChoice, TravelMode } from "@rv-trip/core";
import { localDate, shortDay } from "@rv-trip/core";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * #129 · Q11 A — Fly → Drive on a hop that has bookings asks keep-or-remove.
 * It REPLACES the old toast refusal (vet MED 3): keep parks the flights on the
 * hop (they come back if it flies again), remove deletes them, and "Stay on
 * Fly" changes nothing.
 */
export function HopModePrompt({
  from,
  bookings,
  onChoose,
  onCancel,
}: {
  /** The hop's mode now — the "Stay on …" escape names it. */
  from: TravelMode;
  bookings: Reservation[];
  onChoose: (choice: SegmentBookingsChoice) => void;
  onCancel: () => void;
}) {
  const n = bookings.length;
  const noun = from === "ferry" ? "ferry" : "flight";
  const names = bookings
    .map((r) => {
      const label = r.name.replace(/\s+\S+→\S+$/, "");
      const day = r.startsAt ? shortDay(localDate(r.startsAt, r.startsTz)) : null;
      return day ? `${label}, ${day}` : label;
    })
    .join(" · ");
  return (
    <AlertDialog open onOpenChange={(open: boolean) => !open && onCancel()}>
      <AlertDialogContent className="gap-0 rounded-rv-card border border-rv-warning bg-rv-warning-soft p-[14px] text-rv-ink shadow-rv-xl sm:max-w-[420px]">
        <AlertDialogHeader className="gap-1.5 place-items-start text-left sm:place-items-start sm:text-left">
          <AlertDialogTitle className="text-[14px] font-bold text-rv-ink">
            This hop has {n} {noun} booking{n === 1 ? "" : "s"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[12.5px] text-rv-ink">
            ({names}). Driving doesn’t use {n === 1 ? "it" : "them"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mt-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => onChoose("keep")}
            className="flex-1 cursor-pointer rounded-rv-md border border-rv-green bg-rv-surface px-1 py-1.5 text-[12px] font-bold text-rv-green-ink"
          >
            Keep it, parked
          </button>
          <button
            type="button"
            onClick={() => onChoose("remove")}
            className="flex-1 cursor-pointer rounded-rv-md border border-rv-border-hi bg-rv-surface px-1 py-1.5 text-[12px] font-bold text-rv-ink"
          >
            Remove it
          </button>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 cursor-pointer border-none bg-transparent p-0 text-center text-[11px] text-rv-ink-faded underline"
        >
          Stay on {from === "ferry" ? "Ferry" : "Fly"}
        </button>
      </AlertDialogContent>
    </AlertDialog>
  );
}
