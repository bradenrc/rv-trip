import { Platform } from "react-native";
import { RV } from "@rv-trip/core";

/** The web's rv-* tokens (from @rv-trip/core) plus the few RN-only constants. */
export const C = RV;

export const R = { sm: 4, md: 6, card: 10, pill: 999 } as const;

/** Geist is not bundled in v1; the system stack keeps the same weights/tracking. */
export const F = {
  sans: Platform.select({ ios: "System", default: "sans-serif" }),
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
} as const;
