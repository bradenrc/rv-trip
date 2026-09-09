import { NextResponse } from "next/server";
import { legPatchInput } from "@rv-trip/core";
import { deleteLeg, updateLegFields } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/** The inline rename. 204 on success, 404 when the owner-scoped statement
 * matched no row (a leg that does not exist, or is not the caller's). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = legPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const matched = await updateLegFields(getOwner(), id, parsed.data);
  if (!matched) return NextResponse.json({ error: "leg not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}

/** Delete a leg. Its stops — and their reservations and ideas — cascade with
 * it, which is why the client confirms with the real counts first. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const matched = await deleteLeg(getOwner(), id);
  if (!matched) return NextResponse.json({ error: "leg not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
