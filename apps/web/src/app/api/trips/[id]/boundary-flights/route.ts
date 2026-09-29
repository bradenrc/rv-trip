import { NextResponse } from "next/server";
import { boundaryFlightsInput } from "@rv-trip/core";
import { NoHomeBase, SegmentDateMismatch, createBoundaryFlights, getTripById } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * Add flight with Round trip on (#129 · Q10 A · vet HIGH) — BOTH boundary
 * hops' bookings in ONE transactional save: `outbound` on home → first stop,
 * `return` on last stop → home (created when the trip has none, since
 * `reconcileSegments` never invents one). Round trip off books the outbound
 * alone. Both hops go Fly and are re-timed from their bookings.
 *
 * 201 with the whole trip (the planner swaps it in — the hop set may have
 * grown a row); 400 on a body the schema refuses; 404 when the trip is not the
 * caller's; 409 `no_home_base` when there is no home → first hop to book (no
 * home base on the trip or the household); 409 `segment_date_mismatch` when a
 * flight's date disagrees with the stop it touches (stop dates win, Q3 A) —
 * nothing is written.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = boundaryFlightsInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = await getOwner();
  try {
    const matched = await createBoundaryFlights(owner, id, parsed.data);
    if (!matched) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  } catch (err) {
    if (err instanceof NoHomeBase) {
      return NextResponse.json({ error: "no_home_base" }, { status: 409 });
    }
    if (err instanceof SegmentDateMismatch) {
      return NextResponse.json({ error: "segment_date_mismatch", ...err.conflict }, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json(await getTripById(owner, id), { status: 201 });
}
