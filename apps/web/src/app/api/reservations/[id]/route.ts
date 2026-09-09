import { NextResponse } from "next/server";
import { reservationPatchInput } from "@rv-trip/core";
import { deleteReservation, updateReservationFields } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The widened reservation write: type, name, both dates, the confirmation
 * number and the cost, on top of the rating and note it always carried. Every
 * key optional — the edit form sends only what changed, and the card's stars
 * and note each send one. 204 on success, 404 when the owner-scoped statement
 * matched no row.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = reservationPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const matched = await updateReservationFields(await getOwner(), id, parsed.data);
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
