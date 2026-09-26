"use client";

import { Sparkles } from "lucide-react";
import {
  SURFACE_RADII,
  addAllLabel,
  nearbyBanner,
  nearbyBeyondLine,
  nearbyCountLabel,
  nearbyRowLine,
  surfaceRadiusLabel,
  type NearbySave,
  type NearbySaves,
  type SurfaceRadiusMi,
} from "@rv-trip/core";
import { CategoryTile, Stars } from "@rv-trip/ui";
import { cn } from "@/lib/utils";
import { SheetShell } from "@/components/places/SheetShell";

/**
 * Trip surfacing on the web (#111 i4 · docs/design/111 "Web parity", Q6 A ·
 * Q7 B). The numbers are core's `nearbySaves`, computed on the server by
 * trips/[id]/page.tsx and handed to TripPlanner as the `nearby` prop; this file
 * only draws them. The copy is core's too, so the web and the phone say the
 * same thing — the banner's verb included ("review" here, "tap to review" on
 * the phone).
 */

/** The banner's three strings. */
export function nearbyBannerCopy(nearby: NearbySaves): { title: string; sub: string; dismiss: string } {
  return nearbyBanner(nearby.items.length, nearby.radiusMi, "review");
}

/**
 * The banner: the shipped `SuggestionBar` (components/places/Suggestions.tsx)
 * — rv-info border on rv-info-soft, Sparkles in rv-info-ink, a quiet mono
 * Dismiss in rv-ink-faded. The copy opens the review sheet; Dismiss remembers
 * every save it currently names for this trip. Nothing near: no banner at all.
 */
export function NearbySavesBanner({
  nearby,
  onOpen,
  onDismiss,
}: {
  nearby: NearbySaves;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  if (nearby.items.length === 0) return null;
  const copy = nearbyBannerCopy(nearby);
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-rv-card border border-rv-info bg-rv-info-soft px-3.5 py-[11px]">
      <Sparkles className="size-4 flex-none text-rv-info-ink" />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 cursor-pointer border-none bg-transparent p-0 text-left"
      >
        <span className="text-[13.5px] font-bold text-rv-ink">{copy.title} </span>
        <span className="text-[12.5px] text-rv-ink-muted">{copy.sub}</span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto cursor-pointer border-none bg-transparent p-0 font-mono text-[11px] text-rv-ink-faded"
      >
        {copy.dismiss}
      </button>
    </div>
  );
}

/**
 * The sheet's rows: the fresh answer, plus any row ADDED in this open sheet
 * that a refetch (a radius chip) has since dropped — it is on the trip now, so
 * `nearbySaves` leaves it out, but the sheet keeps showing it as "✓ Idea"
 * (frame 4). Nearest first; the sort is stable, so equal distances keep the
 * server's order.
 */
export function sheetRows(fresh: NearbySave[], added: NearbySave[]): NearbySave[] {
  const ids = new Set(fresh.map((i) => i.saveId));
  return [...fresh, ...added.filter((i) => !ids.has(i.saveId))].sort(
    (a, b) => a.distanceMi - b.distanceMi,
  );
}

/**
 * "Near this trip" — the review sheet, in the shipped `SheetShell`. The radius
 * chips write `trips.surface_radius_mi`; each row's Add copies the save into
 * the trip's ideas (TripPlanner's `addIdeaFromPlace`); the footer's primary is
 * "Add all N to ideas", N being what is still to add.
 */
export function NearbySavesSheet({
  tripTitle,
  nearby,
  rows,
  added,
  onAdd,
  onAddAll,
  onRadius,
  onClose,
}: {
  tripTitle: string;
  nearby: NearbySaves;
  rows: NearbySave[];
  /** Save ids added from this open sheet. */
  added: ReadonlySet<string>;
  onAdd: (item: NearbySave) => void;
  onAddAll: () => void;
  onRadius: (r: SurfaceRadiusMi) => void;
  onClose: () => void;
}) {
  const left = rows.filter((r) => !added.has(r.saveId)).length;
  const beyond = nearby.beyond ? nearbyBeyondLine(nearby.beyond, nearby.radiusMi) : null;
  return (
    <SheetShell
      kicker={tripTitle}
      title="Near this trip"
      hint={nearbyCountLabel(rows.length)}
      submitLabel={addAllLabel(left)}
      submitDisabled={left === 0}
      onSubmit={onAddAll}
      onClose={onClose}
    >
      <div className="flex flex-wrap gap-[5px]">
        {SURFACE_RADII.map((r) => {
          const on = r === nearby.radiusMi;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              onClick={() => onRadius(r)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-rv-pill border px-2 py-0.5 font-mono text-[10px] font-semibold",
                on
                  ? "border-rv-green bg-rv-green-soft text-rv-green-ink"
                  : "border-rv-border-hi bg-rv-surface text-rv-ink-muted",
              )}
            >
              {surfaceRadiusLabel(r)}
            </button>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-rv-card border border-rv-border">
          {rows.map((item) => {
            const done = added.has(item.saveId);
            return (
              <div
                key={item.saveId}
                className="flex items-center gap-[9px] border-t border-rv-border-soft bg-rv-surface px-2.5 py-2 first:border-t-0"
              >
                <CategoryTile type={item.type} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold leading-tight text-rv-ink">{item.name}</div>
                  <div className="flex items-center gap-1 font-mono text-[10px] text-rv-ink-faded">
                    {nearbyRowLine(item)}
                    {item.status === "been" && item.rating ? <Stars value={item.rating} size={10} /> : null}
                  </div>
                </div>
                {/* The web's shipped "Add from Places" Add (TripPlanner's
                    AddFromPlacesPanel), not the wireframe's green-cta fill:
                    the web palette keeps green-cta off every CTA (the
                    nightfall-tokens sweep). Added reads as the outline. */}
                {done ? (
                  <span className="flex-none rounded-rv-md border border-rv-green bg-transparent px-[9px] py-[5px] text-[11px] font-extrabold text-rv-green-ink">
                    ✓ Idea
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAdd(item)}
                    className="flex-none cursor-pointer rounded-rv-md border border-rv-green bg-rv-green-soft px-[9px] py-[5px] text-[11px] font-extrabold text-rv-green-ink"
                  >
                    Add
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {beyond && (
        <div className="rounded-rv-card border border-dashed border-rv-border-hi px-[9px] py-[7px] text-[11.5px] text-rv-ink-faded">
          <b className="text-rv-ink-muted">{beyond.lead}</b>
          {beyond.rest}
        </div>
      )}
    </SheetShell>
  );
}
