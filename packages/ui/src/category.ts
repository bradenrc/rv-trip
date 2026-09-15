import type { LucideIcon } from "lucide-react";
import {
  Tent,
  BedDouble,
  Utensils,
  Binoculars,
  Caravan,
  Ellipsis,
  MapPin,
  CircleDashed,
  Clock,
  CircleCheck,
} from "lucide-react";
import type { IdeaCategory, ReservationType, IdeaStatus } from "@rv-trip/core";

/**
 * The design system's category language — every reservation/idea type maps to
 * one of five categories (Stay / Eat / Do / Travel / Other), each with a fixed
 * icon and color. A single lookup so the visual language never drifts. Colors
 * are CSS custom-property strings (the rv-* theme tokens) for inline use on the
 * tiles that need exact fills.
 */
export type CategoryLabel = "Stay" | "Eat" | "Do" | "Travel" | "Other";

export interface CategoryMeta {
  cat: CategoryLabel;
  Icon: LucideIcon;
  color: string;
  bg: string;
  ink: string;
}

const STAY = {
  color: "var(--color-rv-green)",
  bg: "var(--color-rv-green-soft)",
  ink: "var(--color-rv-green-ink)",
} as const;
const EAT = {
  color: "var(--color-rv-warning)",
  bg: "var(--color-rv-warning-soft)",
  ink: "var(--color-rv-warning)",
} as const;
const DO = {
  color: "var(--color-rv-info-ink)",
  bg: "var(--color-rv-info-soft)",
  ink: "var(--color-rv-info-ink)",
} as const;
const TRAVEL = {
  color: "var(--color-rv-travel)",
  bg: "var(--color-rv-travel-soft)",
  ink: "var(--color-rv-travel-ink)",
} as const;
const OTHER = {
  color: "var(--color-rv-ink-faded)",
  bg: "var(--color-rv-surface-alt)",
  ink: "var(--color-rv-ink-muted)",
} as const;

export function categoryMeta(type: ReservationType): CategoryMeta {
  switch (type) {
    case "campground":
      return { cat: "Stay", Icon: Tent, ...STAY };
    case "lodging":
      return { cat: "Stay", Icon: BedDouble, ...STAY };
    case "dining":
      return { cat: "Eat", Icon: Utensils, ...EAT };
    case "tour":
    case "activity":
    case "event":
      return { cat: "Do", Icon: Binoculars, ...DO };
    case "transport":
      return { cat: "Travel", Icon: Caravan, ...TRAVEL };
    default:
      return { cat: "Other", Icon: type === "other" ? Ellipsis : MapPin, ...OTHER };
  }
}

/**
 * The do/eat/stay vocabulary's ONE door into the five-category language (#80
 * Q2 → A). It lives in this file rather than beside the enum so there is a
 * single lookup and not two drifting ones: an idea's colour and icon are
 * whatever `categoryMeta` already says for the reservation type it reads as.
 */
export function ideaCategoryType(c: IdeaCategory): ReservationType {
  switch (c) {
    case "stay":
      return "campground";
    case "eat":
      return "dining";
    default:
      return "activity";
  }
}

/** The idea's category as the DS renders it — Tent/green, Utensils/amber,
 * Binoculars/blue. */
export function ideaCategoryMeta(c: IdeaCategory): CategoryMeta {
  return categoryMeta(ideaCategoryType(c));
}

/**
 * The same bridge walked the OTHER way (#80 Q6 → A): a saved place's
 * `reservation_type` becoming the idea category the Add-from-Places copy is
 * born with. It reads `categoryMeta(type).cat` rather than re-listing the eight
 * types, so the five-category language stays the single lookup — Stay → stay,
 * Eat → eat, and everything else (Do · Travel · Other) → do.
 */
export function ideaCategoryOfType(type: ReservationType): IdeaCategory {
  switch (categoryMeta(type).cat) {
    case "Stay":
      return "stay";
    case "Eat":
      return "eat";
    default:
      return "do";
  }
}

export interface StatusMeta {
  Icon: LucideIcon;
  color: string;
}

export function statusMeta(status: IdeaStatus): StatusMeta {
  switch (status) {
    case "planned":
      return { Icon: Clock, color: "var(--color-rv-ink)" };
    case "done":
      return { Icon: CircleCheck, color: "var(--color-rv-green)" };
    default:
      return { Icon: CircleDashed, color: "var(--color-rv-ink-faded)" };
  }
}
