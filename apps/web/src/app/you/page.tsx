import { homeBaseRowValue } from "@rv-trip/core";
import { getHouseholdOverview, getPrefsByOwner } from "@rv-trip/db";
import { clerkEnabled, getActor, getOwner } from "@/lib/owner";
import { describePeople } from "@/lib/members";
import { PageShell } from "@/components/nav/PageShell";
import { YouCard, YouLinkRow } from "@/components/you/rows";
import { YouAccount } from "@/components/you/YouAccount";

// Reads the account's preference row on every request; don't prerender.
export const dynamic = "force-dynamic";

/**
 * /you (#173 i3 · #171 · Q1 C) — where the masthead avatar goes. Rig and
 * Settings left the nav bar and fold under it, beside the household's home
 * base and the account rows Clerk's UserButton used to carry.
 *
 * The same server seam /settings uses: owner-scoped reads here, finished
 * strings down. Only the Clerk buttons are a "use client" island.
 */
export default async function YouPage() {
  const owner = await getOwner();
  const [prefs, household, actor] = await Promise.all([
    getPrefsByOwner(owner),
    getHouseholdOverview(owner),
    getActor(),
  ]);
  // One lookup for the household, as settings/page.tsx makes it; keyless it is
  // a no-op and the title falls back to the id — "dev-user".
  const people = await describePeople([
    ...new Set([actor, ...household.members.map((m) => m.userId)]),
  ]);
  const name = people[actor]?.name?.trim() || actor;

  return (
    <PageShell>
      <div className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-ink-faded">
        You
      </div>
      <h1 className="m-0 mb-5 text-[40px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
        {name}
      </h1>

      <div className="max-w-[680px]">
        <YouCard>
          {/* Household has no web page of its own: /settings holds the Home
              base row and the Household card. homeBaseRowValue supplies the ›. */}
          <YouLinkRow href="/settings" label="Household" value={homeBaseRowValue(prefs)} />
          <YouLinkRow href="/rig" label="Rig" />
          <YouLinkRow href="/settings" label="Settings" />
        </YouCard>
        <YouAccount clerk={clerkEnabled()} />
      </div>
    </PageShell>
  );
}
