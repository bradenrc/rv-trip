import type { ReservationType, IdeaStatus } from "../domain/types";
import type { DayKind } from "../domain/derive-days";

/**
 * The design system's colour tokens as DATA — for clients that cannot read
 * CSS custom properties (React Native, map SDKs).
 *
 * Provenance: `packages/ui/styles/entry.css` `@theme` block ("Nightfall &
 * Ember", issue #3). The web reads the CSS variables; this file mirrors their
 * values so the native app wears the same palette. When the palette changes
 * (issue #19 revalues these to Tailwind Slate + Sky), change both — the
 * nightfall-tokens test already guards the two stylesheets against drift, and
 * `tokens.test.ts` guards this file against `entry.css`.
 */
export const RV = {
  navy: "#0a1520",
  navyDeep: "#08182b",
  navySoft: "#21374d",
  green: "#7cd897",
  greenSoft: "#1c3a2b",
  greenInk: "#a8e8bd",
  ember: "#f28c5e",
  emberBright: "#ffa477",
  emberDeep: "#c14d20",
  emberSoft: "#3a2b22",
  ink: "#eef5fa",
  inkMuted: "#b8cbda",
  inkFaded: "#8fa8bd",
  inkSubtle: "#5f7690",
  surface: "#182b3d",
  surfaceAlt: "#101f2d",
  border: "#2e4459",
  borderSoft: "#26394b",
  borderHi: "#3d566c",
  warning: "#f0bc55",
  warningSoft: "#3a3220",
  info: "#6fc4d8",
  infoSoft: "#183440",
  travel: "#a79ec8",
  travelSoft: "#2b2839",
} as const;

export type RvColor = keyof typeof RV;

/** The five-category language (Stay / Eat / Do / Travel / Other). Mirrors
 * `categoryMeta` in @rv-trip/ui minus the icons, which are a DOM concern. */
export type RvCategory = "Stay" | "Eat" | "Do" | "Travel" | "Other";

export interface RvCategoryColors {
  cat: RvCategory;
  color: string;
  bg: string;
  ink: string;
}

export function categoryOf(type: ReservationType): RvCategoryColors {
  switch (type) {
    case "campground":
    case "lodging":
      return { cat: "Stay", color: RV.green, bg: RV.greenSoft, ink: RV.greenInk };
    case "dining":
      return { cat: "Eat", color: RV.warning, bg: RV.warningSoft, ink: RV.warning };
    case "tour":
    case "activity":
    case "event":
      return { cat: "Do", color: RV.info, bg: RV.infoSoft, ink: RV.info };
    case "transport":
      return { cat: "Travel", color: RV.travel, bg: RV.travelSoft, ink: RV.travel };
    default:
      return { cat: "Other", color: RV.inkFaded, bg: RV.surfaceAlt, ink: RV.inkMuted };
  }
}

/** Idea status colour, as `statusMeta` in @rv-trip/ui. */
export function ideaStatusColor(status: IdeaStatus): string {
  switch (status) {
    case "planned":
      return RV.ink;
    case "done":
      return RV.green;
    default:
      return RV.inkFaded;
  }
}

/** The rhythm strip's fills — the same three the web's `KIND_COLOR` names by CSS variable. */
export function dayKindColor(kind: DayKind): string {
  switch (kind) {
    case "drive":
      return RV.navy;
    case "stay":
      return RV.green;
    default:
      return RV.navySoft;
  }
}
