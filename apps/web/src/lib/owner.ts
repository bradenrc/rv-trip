import { auth } from "@clerk/nextjs/server";

/**
 * Is Clerk wired for THIS process? Both keys present → real sessions. Either
 * missing → the local-dev stub, exactly as before #26, so the mc-dev pipeline's
 * walks and CI stay key-free. Checked per call (not at module load) so a test
 * or a walk worktree can flip it through the environment.
 */
export function clerkEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/** The seed's owner, and the tenant every keyless environment runs as. */
export const DEV_OWNER = "dev-user";

/**
 * The current tenant — the Clerk `userId` of the signed-in session, or the
 * dev stub when Clerk is not configured. Every DB read and write is scoped by
 * this value.
 *
 * With Clerk enabled the proxy (src/proxy.ts) has already turned away every
 * unauthenticated request — pages redirect to sign-in, /api/* gets a 401 — so
 * a missing userId here is a wiring error, not a user state. Throwing keeps
 * that invariant loud instead of silently serving another tenant's data.
 */
export async function getOwner(): Promise<string> {
  if (!clerkEnabled()) return DEV_OWNER;
  const { userId } = await auth();
  if (!userId) throw new Error("getOwner: no session — the proxy should have rejected this request");
  return userId;
}
