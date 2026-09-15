import { NextResponse } from "next/server";
import { removeHouseholdMember } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Remove" (#77 · docs/design/81 §3) — take a co-pilot out of the household.
 *
 * Two refusals, and they are genuinely different answers. Somebody who is not
 * in THIS household is a 404: as far as this tenant is concerned they do not
 * exist. The owner is a 409: they plainly do exist, and the removal is refused
 * because the household would keep owning every trip, place and rig with nobody
 * left who could reach them (Q2 = A moved the rows to the household, not to a
 * person).
 *
 * `ctx.params` is a Promise in Next 16 and must be awaited.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params;
  const result = await removeHouseholdMember(await getOwner(), userId);
  if (result === "is_owner") {
    return NextResponse.json({ error: "the household owner cannot be removed" }, { status: 409 });
  }
  if (result === "not_a_member") {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
