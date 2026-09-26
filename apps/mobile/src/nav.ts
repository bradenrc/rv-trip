import { C, F } from "./theme";

/**
 * The header every stack in the app wears — the root Stack (`app/_layout.tsx`)
 * and the Trips tab's nested one (`app/(tabs)/(trips)/_layout.tsx`, #111).
 */
export const STACK_OPTIONS = {
  headerStyle: { backgroundColor: C.navy },
  headerTintColor: C.ink,
  headerTitleStyle: { fontWeight: "800" as const, fontFamily: F.sans },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: C.surfaceAlt },
  headerBackButtonDisplayMode: "minimal" as const,
};
