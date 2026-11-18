import { NextResponse } from "next/server";
import { homeBaseColumns, tripCreateInput } from "@rv-trip/core";
import { createTrip, getTripById, listTripsForOwner, listTripsWithDestinationsForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The dashboard rows — `TripSummary[]` (schema in @rv-trip/core). With
 * `?tree=1` (#186 i4 · #183), every trip as its full tree — `Trip[]`, the query
 * /map already reads — for the phone's Places trip card and Map tab.
 */
export async function GET(req: Request) {
  const owner = await getOwner();
  if (new URL(req.url).searchParams.get("tree") === "1") {
    return NextResponse.json(await listTripsWithDestinationsForOwner(owner));
  }
  return NextResponse.json(await listTripsForOwner(owner));
}

/**
 * Create a trip. The create seeds one unnamed chapter in the same transaction, so the
 * planner it redirects to has a chapter header to hang "Add destination" on. #126 · Q4 A:
 * a `area` is upserted as the household's areas row, the trip
 * points at it, and Chapter 1 opens with one destination spanning the trip. Returns
 * the full tree (201) — the same shape `GET /api/trips/:id` returns under
 * `trip`, with `status` already derived from the dates.
 */
export async function POST(req: Request) {
  const parsed = tripCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = await getOwner();
  // `homeBasePlace` is one object on the wire and three nullable columns
  // underneath — flattened here for the same reason the destination write is (#60).
  const { homeBasePlace, ...fields } = parsed.data;
  const row = await createTrip(owner, {
    ...fields,
    ...homeBaseColumns(homeBasePlace ?? null),
  });
  return NextResponse.json(await getTripById(owner, row.id), { status: 201 });
}
