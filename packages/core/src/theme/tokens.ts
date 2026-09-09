import type { ReservationType, IdeaStatus } from "../domain/types";
import type { DayKind } from "../domain/derive-days";

/**
 * The design system's colour tokens as DATA — for clients that cannot read
 * CSS custom properties (React Native, map SDKs).
 *
 * Provenance: `packages/ui/styles/entry.css`, the raw `.dark { --rv-*: … }`
 * half ("Nightfall & Ember" from issue #3, revalued to Tailwind Slate + Sky by
 * issue #19). The web reads the CSS variables; this file mirrors their values
 * so the native app wears the same palette.
 *
 * Why the DARK half specifically: since #19 the stylesheet carries the palette
 * twice — light on `:root`, dark on `.dark` — behind one `@theme inline` map.
 * Night is the product default and the native app ships no theme toggle, so
 * the dark half is the one it mirrors. Change both when the palette changes:
 * the nightfall-tokens test guards the two stylesheets against drift, and
 * `tokens.test.ts` guards this file against `entry.css`.
 */
export const RV = {
  navy: "#020617",
  navyDeep: "#0f172a",
  navySoft: "#334155",
  green: "#34d399",
  greenSoft: "#022c22",
  greenInk: "#6ee7b7",
  accent: "#38bdf8",
  accentBright: "#7dd3fc",
  accentDeep: "#0ea5e9",
  accentSoft: "#082f49",
  ink: "#f1f5f9",
  inkMuted: "#cbd5e1",
  inkFaded: "#94a3b8",
  inkSubtle: "#64748b",
  surface: "#1e293b",
  surfaceAlt: "#0f172a",
  border: "#334155",
  borderSoft: "#1e293b",
  borderHi: "#475569",
  warning: "#fbbf24",
  warningSoft: "#451a03",
  info: "#22d3ee",
  infoSoft: "#083344",
  travel: "#a78bfa",
  travelSoft: "#2e1065",
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
