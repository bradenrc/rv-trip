import { NextResponse } from "next/server";
import { segmentPatchInput } from "@rv-trip/core";
import { SegmentHasBookings, updateSegmentMode } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * A hop's mode switch (#104 · Q7 B) — the travel card's Drive / Fly / Ferry
 * control and a drive row's "Fly this hop instead" / "Take a ferry instead".
 *
 * 204 on success; 404 when the owner-scoped UPDATE matched no segment; 409
 * `segment_has_bookings` when a hop with flights or ferries on it is switched
 * back to Drive — remove them first (vet MED). A drive → fly switch drops the
 * pair out of `drivePairs`, so its Navigate, its rail miles and its HERE call
 * go with it.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = segmentPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const matched = await updateSegmentMode(await getOwner(), id, parsed.data.mode);
    if (!matched) return NextResponse.json({ error: "segment not found" }, { status: 404 });
  } catch (err) {
    if (err instanceof SegmentHasBookings) {
      return NextResponse.json({ error: "segment_has_bookings" }, { status: 409 });
    }
    throw err;
  }
  return new NextResponse(null, { status: 204 });
}
