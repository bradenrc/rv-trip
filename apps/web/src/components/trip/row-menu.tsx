"use client";

import { Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The row menu (⋯) — the shelf every structural and destructive verb lives on:
 * the leg header, the stop row, and (this item) the reservation and idea cards
 * inside the stop sheet. One trigger, one surface, so all four read as the same
 * object rather than four designs.
 *
 * The shadcn primitive's stock look already resolves to the design's palette
 * (`--popover` is rv-navy-soft, `--popover-foreground` is rv-ink in
 * globals.css), but the geometry does not: the content is sized to the trigger,
 * and this trigger is a 26px kebab. So the surface is re-stated in rv tokens
 * verbatim from the wireframe rather than left to inherit.
 *
 * Lifted out of RouteView.tsx unchanged when the sheet grew menus of its own.
 */
export const MENU_SURFACE =
  "w-[210px] min-w-[210px] rounded-rv-md border border-rv-border-hi bg-rv-navy-soft p-[5px] shadow-rv-lg";
/** No destructive variant anywhere in this epic — the loss is carried by the
 * documented attention colour (amber), never by shadcn's off-palette red. */
export const MENU_ITEM =
  "cursor-pointer gap-2 rounded-rv-sm px-[9px] py-1.5 text-[12.5px] text-rv-ink focus:bg-rv-green-soft";
export const MENU_ITEM_WARN =
  "cursor-pointer gap-2 rounded-rv-sm px-[9px] py-1.5 text-[12.5px] text-rv-warning focus:bg-rv-warning-soft";

export function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="inline-flex h-6 w-[26px] cursor-pointer items-center justify-center rounded-rv-sm border border-rv-border bg-transparent text-rv-ink-faded"
      >
        <Ellipsis className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU_SURFACE}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The right-hand hint on a menu item ("inline", "confirm", "→ floating") — it
 * says what the verb DOES before you press it, not what it is called.
 *
 * The wireframe paints it with the subtle ink, which the shipped role table
 * reserves for empty stars and grip handles rather than glyphs (the
 * nightfall-tokens sweep enforces it). rv-ink-faded is the documented colour
 * for mono meta text, so the hint takes that instead.
 */
export function MenuHint({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto font-mono text-[9.5px] text-rv-ink-faded">{children}</span>;
}
