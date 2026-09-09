import { NextResponse } from "next/server";
import { reservationCreateInput } from "@rv-trip/core";
import { createReservation } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Add reservation" — and the body an undone DELETE re-POSTs, which is why the
 * whole editable row travels rather than the four fields the form used to
 * collect. 201 carries the core `Reservation` shape, so the sheet can splice
 * exactly what it renders.
 *
 * The body is derived from the core schema now that this item edits it (the
 * shape was hand-rolled here). An insert has no WHERE to match zero rows, so
 * ownership is proved by an explicit check on the parent STOP inside the
 * mutation, and a stop the caller does not own reads as 404.
 */
export async function POST(req: Request) {
  const parsed = reservationCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const row = await createReservation(await getOwner(), parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "stop not found" }, { status: 404 });
  }
}
