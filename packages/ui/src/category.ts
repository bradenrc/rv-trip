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
import type { ReservationType, IdeaStatus } from "@rv-trip/core";

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
