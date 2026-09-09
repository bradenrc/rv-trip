"use client";

import { MapPin, Sparkles } from "lucide-react";
import type { PlaceSuggestion, SuggestionShelf } from "@rv-trip/core";
import { CategoryTile, Stars } from "@rv-trip/ui";

/**
 * "Been there?" — the suggestion bar and its cards, docs/design/41 §5 and §7.
 *
 * Neither is a `PlaceCard`: the DS card renders exactly one action with a
 * hard-coded label, has no badge slot, and takes a full `SavedPlace` (nested
 * `place`, `id`, `ownerId`) that a suggestion does not have yet. The frame
 * draws a "Suggested" badge and TWO actions, so this is an app-local component
 * composed from the same DS parts — `CategoryTile` and `Stars` — and
 * `packages/ui` ships no API change in this epic.
 *
 * Both render only when there is something to show; the "no suggestions" state
 * is the absence of these elements (Gap 3b), which is why `buildSuggestionShelf`
 * returns `null` rather than an empty shelf.
 */

export function SuggestionBar({
  shelf,
  onDismissAll,
}: {
  shelf: SuggestionShelf;
  onDismissAll: () => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-rv-card border border-rv-info bg-rv-info-soft px-3.5 py-[11px]">
      <Sparkles className="size-4 flex-none text-rv-info-ink" />
      <span className="min-w-0">
        <span className="text-[13.5px] font-bold text-rv-ink">{shelf.headline} </span>
        <span className="text-[12.5px] text-rv-ink-muted">{shelf.detail}</span>
      </span>
      {/* The frame tints "Dismiss all" with the subtle ink, which the palette
          guard (packages/core/src/theme/nightfall-tokens.test.ts) scopes to
          non-text only — empty stars, grips, disabled icons. This quiet mono
          line takes rv-ink-faded instead, the documented role for meta text. */}
      <button
        type="button"
        onClick={onDismissAll}
        className="ml-auto cursor-pointer border-none bg-transparent p-0 font-mono text-[11px] text-rv-ink-faded"
      >
        Dismiss all
      </button>
    </div>
  );
}

export function SuggestedPlaceCard({
  suggestion,
  saving,
  onDismiss,
  onAccept,
}: {
  suggestion: PlaceSuggestion;
  saving: boolean;
  onDismiss: () => void;
  onAccept: () => void;
}) {
  const s = suggestion;
  return (
    <div className="flex flex-col gap-[11px] rounded-rv-card border border-rv-info bg-rv-surface px-[18px] py-4 shadow-rv-sm">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <CategoryTile type={s.type} />
          <div className="min-w-0">
            <h3 className="m-0 mb-0.5 truncate text-[16px] font-extrabold tracking-[-0.01em] text-rv-ink">
              {s.name}
            </h3>
            {s.region && (
              <div className="inline-flex items-center gap-[5px] font-mono text-[12px] text-rv-ink-faded">
                <MapPin className="size-3 text-rv-green" />
                {s.region}
              </div>
            )}
          </div>
        </div>
        <span className="flex-none rounded-rv-pill bg-rv-info-soft px-[9px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-rv-info-ink">
          Suggested
        </span>
      </div>

      {s.note && <p className="m-0 text-[13.5px] leading-relaxed text-rv-ink-muted">{s.note}</p>}

      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-rv-border pt-1.5">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Stars value={s.rating} />
          <span className="truncate font-mono text-[11.5px] text-rv-ink-faded">
            · {s.tripTitle}
          </span>
        </span>
        <span className="flex flex-none gap-[7px]">
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer rounded-rv-md border border-rv-border-hi bg-transparent px-[11px] py-1.5 text-[13px] font-bold text-rv-ink-muted"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={saving}
            className="cursor-pointer rounded-rv-md border-none bg-rv-ember px-[11px] py-1.5 text-[13px] font-bold text-rv-navy disabled:opacity-60"
          >
            Add to Been
          </button>
        </span>
      </div>
    </div>
  );
}
