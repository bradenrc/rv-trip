/**
 * The planner model moved to `@rv-trip/core/planner` (C0, issue #31) so the
 * native app shares it. This path is kept so nothing in apps/web moves; new
 * code should import from "@rv-trip/core" directly.
 */
export * from "@rv-trip/core/planner";
