import { clerkEnabled } from "@/lib/owner";

/**
 * Who the household's user ids actually ARE (#77 · docs/design/81 §3).
 *
 * `household_members` stores the membership and nothing else — no name, no
 * email — so the Settings card's "Braden · braden@example.com" has to come from
 * the identity provider. This module is the one place that asks, for the same
 * reason `lib/owner.ts` is the one place that asks who the tenant is: every
 * other file gets plain strings.
 *
 * Three properties matter more than the lookup itself:
 *
 *   keyless   — no Clerk, no call, an empty map. The caller's fallback is the
 *               user id, so the card still renders every state on the branch
 *               the walks and the whole route suite run on.
 *   forgiving — a failed or partial lookup is a missing NAME, never a failed
 *               page. /settings' other three cards need no network at all, and
 *               losing the whole page because Clerk's Backend API was slow
 *               would be a poor trade for an email address.
 *   server-only — `clerkClient()` speaks to the Backend API with the SECRET
 *               key. It is imported dynamically so nothing pulls it into a
 *               bundle that merely wanted `clerkEnabled()`, which is the same
 *               care `owner.ts` takes with `@rv-trip/db`.
 */
export interface PersonProfile {
  name: string;
  email: string;
}

export type PeopleById = Record<string, PersonProfile>;

export async function describePeople(userIds: string[]): Promise<PeopleById> {
  if (!clerkEnabled() || userIds.length === 0) return {};
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ userId: userIds, limit: userIds.length });
    const people: PeopleById = {};
    for (const user of data) {
      const email =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
        user.emailAddresses[0]?.emailAddress ??
        "";
      people[user.id] = { name: displayName(user, email), email };
    }
    return people;
  } catch {
    // Named people are a nicety here; the membership is the fact. Fall back to
    // the ids rather than failing the settings page.
    return {};
  }
}

/** First + last, else the username, else the local part of the email. Never the
 * bare email — the row already shows that underneath. */
function displayName(
  user: { firstName: string | null; lastName: string | null; username: string | null },
  email: string,
): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.username || email.split("@")[0] || "";
}
