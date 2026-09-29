import { NextResponse } from "next/server";
import { segmentPatchInput } from "@rv-trip/core";
import { updateSegmentMode } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * A hop's mode switch (#104 · Q7 B) — the travel card's Drive / Fly / Ferry
 * control and a drive row's "Fly this hop instead" / "Take a ferry instead".
 *
 * 204 on success; 404 when the owner-scoped UPDATE matched no segment. #129 ·
 * Q11 A: a hop with flights on it CAN be switched to Drive now — `bookings`
 * says whether they are kept (parked on the hop, back when it flies) or
 * removed; absent reads as keep. The 409 `segment_has_bookings` is gone. A
 * drive → fly switch drops the pair out of `drivePairs`, so its Navigate, its
 * rail miles and its HERE call go with it, and re-times the hop from any
 * bookings it kept.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = segmentPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const matched = await updateSegmentMode(await getOwner(), id, parsed.data.mode, parsed.data.bookings);
  if (!matched) return NextResponse.json({ error: "segment not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
