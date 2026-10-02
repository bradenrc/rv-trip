import { NextResponse } from "next/server";
import { reservationPatchInput } from "@rv-trip/core";
import { SegmentDateMismatch, deleteReservation, updateReservationFields } from "@rv-trip/db";
import { getActor, getOwner } from "@/lib/owner";
import { areaResolver } from "@/lib/places";

/**
 * The widened reservation write: type, name, both dates, the confirmation
 * number and the cost, on top of the rating and note it always carried. Every
 * key optional — the edit form sends only what changed, and the card's stars
 * and note each send one. 204 on success, 404 when the owner-scoped statement
 * matched no row. #124: a hop booking's Edit sends its clock too
 * (`startsAt`/`endsAt` with their zones) and re-times the hop — 409
 * `segment_date_mismatch` when the new clock disagrees with the destination dates.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = reservationPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  let matched: boolean;
  try {
    matched = await updateReservationFields(
      await getOwner(),
      id,
      parsed.data,
      await getActor(),
      // #113 · "How was it?" writes through; the resolver reads the destination's point.
      { resolveArea: areaResolver() },
    );
  } catch (err) {
    // #124 · an edited flight re-times its hop; destination dates win (Q3 A).
    if (err instanceof SegmentDateMismatch) {
      return NextResponse.json({ error: "segment_date_mismatch", ...err.conflict }, { status: 409 });
    }
    throw err;
  }
  if (!matched) return NextResponse.json({ error: "reservation not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}

/**
 * A reservation is a LEAF: nothing cascades from it, so there is no confirm
 * dialog in front of this — the client removes it optimistically and offers a
 * six-second undo, which re-POSTs the row rather than resurrecting this id.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const matched = await deleteReservation(await getOwner(), id);
  if (!matched) return NextResponse.json({ error: "reservation not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
