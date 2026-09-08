import { NextResponse } from "next/server";
import { listTripsForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/** The dashboard rows — `TripSummary[]` (schema in @rv-trip/core). */
export async function GET() {
  return NextResponse.json(await listTripsForOwner(getOwner()));
}
