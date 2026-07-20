import { NextResponse } from "next/server";
import { promoteIdeaToReservation } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const row = await promoteIdeaToReservation(getOwner(), id);
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "idea not found" }, { status: 404 });
  }
}
