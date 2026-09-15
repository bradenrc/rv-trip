import { headers } from "next/headers";
import { getHouseholdOverview, getPrefsByOwner } from "@rv-trip/db";
import { clerkEnabled, getActor, getOwner } from "@/lib/owner";
import { describePeople } from "@/lib/members";
import { PageShell } from "@/components/nav/PageShell";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { inviteView, memberView } from "@/components/settings/household-view";

// Reads the account's preference row on every request; don't prerender.
export const dynamic = "force-dynamic";

/**
 * /settings (issue #38 · #77) — the account's four preferences and, since #77,
 * the household it shares them with. The door the phone tab bar's fifth tab
 * opens.
 *
 * The same server -> client seam `trips/[id]/page.tsx` uses: the server reads
 * the owner-scoped rows and hands them to one "use client" form. The row is what
 * the unresolved first render draws, before `localStorage` is readable.
 *
 * The household half follows that seam exactly (docs/design/81 dev note 3):
 * household + members + the live invite are read HERE, turned into finished
 * strings here, and handed down as props. `HouseholdCard` fetches nothing on
 * mount, and — because every date is formatted in UTC on this side — the markup
 * the browser hydrates is the markup the server sent.
 */
export default async function SettingsPage() {
  // `getOwner()` is memoized per request (lib/owner.ts), so asking twice costs
  // one household lookup, not two — and each read still says out loud what it
  // is scoped by.
  const [prefs, household] = await Promise.all([
    // null on an account that has never chosen anything — every column is
    // nullable on purpose, so the product defaults still win.
    getPrefsByOwner(await getOwner()),
    getHouseholdOverview(await getOwner()),
  ]);

  const actor = await getActor();
  // One call for everyone in the household; keyless it is a no-op and the card
  // falls back to the user ids (lib/members.ts).
  const people = await describePeople(household.members.map((m) => m.userId));

  return (
    <PageShell>
      <SettingsForm
        prefs={prefs}
        household={{
          name: household.name,
          members: household.members.map((m) =>
            memberView(m, {
              actor,
              name: people[m.userId]?.name ?? "",
              email: people[m.userId]?.email ?? "",
            }),
          ),
          invite: household.invite
            ? inviteView(household.invite, await requestOrigin())
            : null,
          // No Clerk, no identity provider, so there is nobody to invite: the
          // button renders and goes dead, the way Account.tsx's DevAccount stub
          // renders and does nothing.
          canInvite: clerkEnabled(),
        }}
      />
    </PageShell>
  );
}

/**
 * The origin the invite link has to be pasted from. Taken from the REQUEST
 * rather than from an env var: this app answers on a preview URL, on
 * roadvalet.com and on localhost, and a link that names the wrong one of those
 * is worse than no link at all.
 */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
