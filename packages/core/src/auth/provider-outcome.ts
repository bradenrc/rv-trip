/**
 * What a one-tap provider attempt (Apple / Google, issue #123) came to.
 *
 *   - "session"    — Clerk created a session; the caller `setActive`s it.
 *   - "cancelled"  — the person backed out (Apple's sheet, Google's browser tab).
 *                    No error text: backing out isn't a failure.
 *   - "incomplete" — the exchange ran but ended without a session (a sign-up
 *                    transfer left at `missing_requirements`, a sign-in that
 *                    needs another factor). The caller shows GENERIC_ERROR.
 *
 * Pure and Clerk-free so it runs under vitest; `apps/mobile/app/sign-in.tsx`
 * maps the hook results onto these inputs.
 */
export type ProviderOutcome = "session" | "cancelled" | "incomplete";

export interface ProviderAttempt {
  /** `createdSessionId` from `startAppleAuthenticationFlow` / `startSSOFlow`. */
  createdSessionId: string | null;
  /** Whether Clerk actually started a sign-in or sign-up during this attempt
   * (the resource id changed). Apple's hook returns before any Clerk call when
   * the sheet is cancelled, so this is how a cancel is told apart. */
  attempted: boolean;
  /** Google only: `authSessionResult.type` from the in-app browser. Absent for
   * Apple's native sheet. */
  browserResultType?: string | null;
}

export function providerOutcome(a: ProviderAttempt): ProviderOutcome {
  if (a.createdSessionId) return "session";
  if (a.browserResultType != null) {
    return a.browserResultType === "success" ? "incomplete" : "cancelled";
  }
  return a.attempted ? "incomplete" : "cancelled";
}
