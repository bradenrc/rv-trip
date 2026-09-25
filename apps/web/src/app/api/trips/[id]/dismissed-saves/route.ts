import { NextResponse } from "next/server";
import { dismissSavesInput } from "@rv-trip/core";
import { dismissSavesForTrip } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The banner's Dismiss (#111 Q6 A): `{ saveIds }` — every save surfaced at
 * that moment — remembered for this trip, so the banner returns only when a
 * new save matches. 204; 404 for a trip that is not the caller's. Ids that are
 * not the caller's saves are dropped by the mutation, not recorded.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = dismissSavesInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const matched = await dismissSavesForTrip(await getOwner(), id, parsed.data.saveIds);
  if (!matched) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
