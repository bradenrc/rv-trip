import { NextResponse } from "next/server";
import { legCreateInput } from "@rv-trip/core";
import { createLeg } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Add leg". The new leg is appended to the end of the trip — the client never
 * picks a sortOrder — and comes back at 201 in the core `Leg` shape (with an
 * empty `stops`), so the planner can splice it into the tree it already holds.
 *
 * An insert has no WHERE to match zero rows, so ownership is proved by an
 * explicit check on the PARENT trip inside the same transaction; a trip the
 * caller does not own reads as 404, exactly like a trip that does not exist.
 */
export async function POST(req: Request) {
  const parsed = legCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const leg = await createLeg(await getOwner(), parsed.data);
    return NextResponse.json(leg, { status: 201 });
  } catch {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
}
