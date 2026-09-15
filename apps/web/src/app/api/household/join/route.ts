import { NextResponse } from "next/server";
import { z } from "zod";
import { redeemHouseholdInvite } from "@rv-trip/db";
import { getActor, getOwner } from "@/lib/owner";

/**
 * Redeem a join link (#77 · docs/design/81 §4) — `{ token } → 204 | 409`.
 *
 * The two seams are passed separately, and this is the first route where the
 * difference bites: `getOwner()` is the household the visitor is leaving (it is
 * deleted, empty, inside the transaction) and `getActor()` is the person who
 * gets the new member row. Neither is ever taken from the body — the body says
 * only WHICH invite.
 *
 * The 409 body carries the CODE, not a sentence: §4 lists three codes and the
 * page renders one card per code (`components/join/join-view.ts`), so the
 * string has to be machine-readable. A token that names no invite is a 404,
 * not a 409 — nothing conflicts, there is simply nothing there.
 *
 * "Already in that household" — the owner opening their own link — is a 204.
 * Nothing is written and the invite is not spent, because there is nothing to
 * do, and telling someone they cannot join a household they are in would be
 * a refusal about nothing.
 */
const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const verdict = await redeemHouseholdInvite(parsed.data.token, {
    userId: await getActor(),
    householdId: await getOwner(),
  });

  if (verdict === "invite_not_found") {
    return NextResponse.json({ error: "invite not found" }, { status: 404 });
  }
  if (verdict !== "ok" && verdict !== "already_here") {
    return NextResponse.json({ error: verdict }, { status: 409 });
  }
  return new NextResponse(null, { status: 204 });
}
