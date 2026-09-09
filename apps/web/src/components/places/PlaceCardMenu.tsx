"use client";

import { Check, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { SavedPlace } from "@rv-trip/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The ⋯ menu of docs/design/41 §5 — Edit place / Been there… / Delete, on the
 * shipped shadcn `dropdown-menu`.
 *
 * It is anchored BESIDE `PlaceCard`, never inside it: the DS card ships two
 * optional props and this epic gives them no siblings, so `packages/ui` has no
 * API change here. The frame draws the trigger in the card's footer row, which
 * `PlaceCard` owns end to end (`Places.tsx:67` — a justify-between row with a
 * variable-width action button). Anchoring inside it would need either a DS
 * slot or a guess at that button's width, so the trigger sits on the card's
 * bottom-right corner instead, in the 16px grid gutter: level with the footer,
 * clear of every element the card draws. Flagged for the walk.
 */
export function PlaceCardMenu({
  place,
  onEdit,
  onGraduate,
  onDelete,
}: {
  place: SavedPlace;
  onEdit: () => void;
  onGraduate: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More actions for ${place.place.name}`}
        className="absolute -bottom-3 -right-3 inline-flex size-7 cursor-pointer items-center justify-center rounded-rv-pill border border-rv-border-hi bg-rv-surface text-rv-ink-muted shadow-rv-sm"
      >
        <Ellipsis className="size-[15px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-[176px]">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit place
        </DropdownMenuItem>
        {/* Graduation is a one-way move; a row already on the "been" shelf has
            nowhere to go. */}
        {place.status === "want" ? (
          <DropdownMenuItem onSelect={onGraduate}>
            <Check />
            Been there&hellip;
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
