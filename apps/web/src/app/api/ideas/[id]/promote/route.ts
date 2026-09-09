import { NextResponse } from "next/server";
import { ideaPromoteInput } from "@rv-trip/core";
import { promoteIdeaToReservation } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Book" — the idea becomes a reservation of the type you picked.
 *
 * `type` is OPTIONAL and defaults to the `"activity"` the mutation used to
 * hardcode, so a caller that posts no body at all still works. A body-less
 * POST has no JSON to read, which is why the parse is guarded rather than
 * awaited straight into `safeParse`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = ideaPromoteInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const row = await promoteIdeaToReservation(await getOwner(), id, parsed.data.type);
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "idea not found" }, { status: 404 });
  }
}
