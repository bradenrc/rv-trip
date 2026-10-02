import { NextResponse } from "next/server";
import { destinationCreateInput } from "@rv-trip/core";
import { createDestination } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Add destination". Appended to the end of its chapter — the client never picks a
 * sortOrder — and born floating unless the caller already has dates. 201
 * carries the core `Destination` shape (empty `reservations`/`ideas`), so the planner
 * can splice it into the tree it holds.
 *
 * The AREA chapter is checked explicitly inside the transaction: an insert
 * has no WHERE to match zero rows, so ownership cannot ride on the statement.
 */
export async function POST(req: Request) {
  const parsed = destinationCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const destination = await createDestination(await getOwner(), parsed.data);
    return NextResponse.json(destination, { status: 201 });
  } catch {
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }
}
