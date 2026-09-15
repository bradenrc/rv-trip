import { NextResponse } from "next/server";
import { createHouseholdInvite } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The household's join link (#77 · docs/design/81 §3). Q3 = B — no mailer, no
 * webhook: POST mints one `household_invites` row and hands back the token the
 * Settings card renders as `roadvalet.com/join/<token>` for you to send her
 * yourself.
 *
 * No body, so no Zod `safeParse` here: there is nothing a caller can say. WHICH
 * household is never theirs to name either — it comes from `getOwner()`, the
 * same seam every other write in this app is scoped by.
 *
 * A second POST supersedes the household's previous live invite rather than
 * leaving two working links (see `createHouseholdInvite`).
 */
export async function POST() {
  const invite = await createHouseholdInvite(await getOwner());
  return NextResponse.json(
    { token: invite.token, expiresAt: invite.expiresAt.toISOString() },
    { status: 201 },
  );
}
