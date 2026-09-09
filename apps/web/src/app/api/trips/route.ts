import { NextResponse } from "next/server";
import { tripCreateInput } from "@rv-trip/core";
import { createTrip, getTripById, listTripsForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/** The dashboard rows — `TripSummary[]` (schema in @rv-trip/core). */
export async function GET() {
  return NextResponse.json(await listTripsForOwner(await getOwner()));
}

/**
 * Create a trip. The create seeds one empty "Leg 1" in the same transaction, so
 * the planner it redirects to has a leg header to hang "Add stop" on. Returns
 * the full tree (201) — the same shape `GET /api/trips/:id` returns under
 * `trip`, with `status` already derived from the dates.
 */
export async function POST(req: Request) {
  const parsed = tripCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = await getOwner();
  const row = await createTrip(owner, parsed.data);
  return NextResponse.json(await getTripById(owner, row.id), { status: 201 });
}
