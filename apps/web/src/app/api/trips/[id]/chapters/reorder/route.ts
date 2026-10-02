import { NextResponse } from "next/server";
import { chapterReorderInput } from "@rv-trip/core";
import { reorderTripChapters } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Move chapter up/down" sends the whole new order rather than a swap, so the
 * renumber is one transaction and two chapters can never end up sharing a
 * sortOrder. Scoped on the trip (the ownership root); 404 when it is not the
 * caller's. Ids from another trip renumber nothing — each statement carries
 * `chapters.tripId` too.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = chapterReorderInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    await reorderTripChapters(await getOwner(), id, parsed.data.order);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
}
