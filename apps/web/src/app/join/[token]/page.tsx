import { notFound, redirect } from "next/navigation";
import {
  getHouseholdInvite,
  getHouseholdOverview,
  householdIsEmpty,
  joinVerdict,
} from "@rv-trip/db";
import { clerkEnabled, getActor, getOwner } from "@/lib/owner";
import { describePeople } from "@/lib/members";
import { PageShell } from "@/components/nav/PageShell";
import { JoinAccept } from "@/components/join/JoinAccept";
import { JoinRefused } from "@/components/join/JoinRefused";
import { acceptTitle, signedInLabel } from "@/components/join/join-view";

// Resolves an invite and a session on every request; never prerender.
export const dynamic = "force-dynamic";

/**
 * `/join/<token>` (#77 · docs/design/81 §4) — the two things that can happen
 * when the link Braden sent his wife is opened.
 *
 * `src/proxy.ts` is deliberately NOT edited for this route. It already protects
 * every non-API path, so an unsigned visitor is sent to sign-in and comes back
 * here signed in — which is exactly the order this needs, because the join
 * binds a PERSON to a household and there is no person until then. (The app
 * ships no `/sign-in` route — auth is the modal in the masthead — so this is
 * the first document path that depends on Clerk's hosted redirect, and it is
 * the one thing on this surface only a keyed walk can prove.)
 *
 * The page renders; it never writes. Which card to draw is `joinVerdict`, the
 * same pure function `redeemHouseholdInvite` re-runs inside its transaction, so
 * the card and the button cannot disagree about the same row.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invite = await getHouseholdInvite(token);
  // A token that names no invite is not a refusal — there is nothing here.
  if (!invite) notFound();
  // `getOwner()` mints the visitor's own 1-member household the first time it
  // sees her (lib/owner.ts). That is the household the join deletes, and it has
  // to exist before it can be emptied and dropped.
  const visitorHousehold = await getOwner();

  const verdict = joinVerdict({
    invite,
    now: new Date(),
    visitorHousehold,
    visitorHouseholdIsEmpty: await householdIsEmpty(visitorHousehold),
  });

  // Unreachable — the invite was read above — but it keeps the union
  // exhaustive, so `verdict` narrows to §4's three refusal codes below.
  if (verdict === "invite_not_found") notFound();
  // Her own household's link: nothing to join, so nothing to say.
  if (verdict === "already_here") redirect("/");

  const household = await getHouseholdOverview(invite.householdId);
  const owner = household.members.find((m) => m.role === "owner") ?? household.members[0];
  const actor = await getActor();
  const people = await describePeople([actor, ...(owner ? [owner.userId] : [])]);
  // Unnameable without an identity provider — keyless, `describePeople` is a
  // no-op and the ids stand in, exactly as the Household card's rows do.
  const inviter = (owner && people[owner.userId]?.name) || owner?.userId || household.name;

  return (
    <PageShell>
      <div className="mx-auto max-w-[430px]">
        {verdict === "ok" ? (
          <JoinAccept
            token={token}
            title={acceptTitle(inviter, household.name)}
            signedIn={signedInLabel(people[actor]?.email || actor, invite.expiresAt)}
          />
        ) : (
          <JoinRefused
            code={verdict}
            inviter={inviter}
            path={`/join/${encodeURIComponent(token)}`}
            canSwitchAccount={clerkEnabled()}
          />
        )}
      </div>
    </PageShell>
  );
}
