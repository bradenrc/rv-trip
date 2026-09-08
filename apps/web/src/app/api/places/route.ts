import { NextResponse } from "next/server";
import { listSavedPlacesForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/** The Places library, both shelves — `SavedPlace[]`. */
export async function GET() {
  return NextResponse.json(await listSavedPlacesForOwner(getOwner()));
}
