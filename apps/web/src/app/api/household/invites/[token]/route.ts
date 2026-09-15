import { NextResponse } from "next/server";
import { cancelHouseholdInvite } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Cancel invite" (#77 · docs/design/81 §3) — revoke a link still in flight.
 *
 * One 404 covers every refusal: no such token, another household's token, and a
 * token already redeemed. They are the same answer on purpose — the response
 * must not tell whoever holds a URL whether it names a real invite somewhere
 * else. The mutation carries the household in its WHERE, so this is scoping,
 * not just a message.
 *
 * `ctx.params` is a Promise in Next 16 and must be awaited (the shipped pattern
 * is api/places/[id]/route.ts).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!(await cancelHouseholdInvite(await getOwner(), token))) {
    return NextResponse.json({ error: "invite not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
