import { cache } from "react";
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

/** The seeded PERSON — the member a keyless process acts as (`getActor()`). */
export const DEV_OWNER = "dev-user";

/**
 * The seeded HOUSEHOLD — the tenant a keyless process reads and writes as
 * (`getOwner()`). A literal rather than a generated id on purpose: the keyless
 * branch has to answer it without a key and without a database lookup, which
 * is what keeps walks and the whole apps/web route suite key-free. The same
 * string is what `packages/db/src/seed.ts` owns its rows by and what migration
 * 0007's backfill moves `dev-user`'s rows onto.
 */
export const DEV_HOUSEHOLD = "dev-household";

/**
 * The current tenant — the HOUSEHOLD that owns the rows, not the person
 * (#77 · docs/design/81 §2). Every DB read and write is scoped by this value,
 * and the call sites did not change when its meaning did: it was a Clerk user
 * id, it is now a household id, and both are opaque strings in an `owner_id`
 * column.
 *
 * With Clerk enabled this resolves the signed-in user through
 * `household_members`, creating their own 1-member household the first time
 * they are seen — see `ensureHouseholdForUser` for what happens when two of a
 * new user's requests race.
 *
 * Wrapped in React's `cache`, so the lookup runs ONCE per request however many
 * times a page or handler asks (api/places/[id] calls it in both PATCH and
 * DELETE, trips/[id]/page.tsx above every mutation under it). Outside a
 * request scope — a direct handler call in vitest — `cache` has no dispatcher
 * and simply calls through, so nothing is memoized between tests.
 *
 * `@rv-trip/db` is imported DYNAMICALLY, and only on this branch: `proxy.ts`
 * and `app/layout.tsx` import `clerkEnabled` from this module, and a static
 * import would pull the pg pool — and packages/db's module-scope throw on an
 * unset DATABASE_URL — into the proxy bundle, which needs neither.
 */
export const getOwner = cache(async function getOwner(): Promise<string> {
  if (!clerkEnabled()) return DEV_HOUSEHOLD;
  const { ensureHouseholdForUser } = await import("@rv-trip/db");
  return ensureHouseholdForUser(await getActor());
});

/**
 * The current MEMBER — who is acting, as opposed to whose rows these are
 * (#78). The Clerk `userId` of the signed-in session, or the dev stub when
 * Clerk is not configured.
 *
 * With Clerk enabled the proxy (src/proxy.ts) has already turned away every
 * unauthenticated request — pages redirect to sign-in, /api/* gets a 401 — so
 * a missing userId here is a wiring error, not a user state. Throwing keeps
 * that invariant loud instead of silently serving another tenant's data.
 */
export async function getActor(): Promise<string> {
  if (!clerkEnabled()) return DEV_OWNER;
  const { userId } = await auth();
  if (!userId) throw new Error("getActor: no session — the proxy should have rejected this request");
  return userId;
}
