import { NextResponse } from "next/server";
import { stopCreateInput } from "@rv-trip/core";
import { createStop } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Add stop". Appended to the end of its leg — the client never picks a
 * sortOrder — and born floating unless the caller already has dates. 201
 * carries the core `Stop` shape (empty `reservations`/`ideas`), so the planner
 * can splice it into the tree it holds.
 *
 * The DESTINATION leg is checked explicitly inside the transaction: an insert
 * has no WHERE to match zero rows, so ownership cannot ride on the statement.
 */
export async function POST(req: Request) {
  const parsed = stopCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const stop = await createStop(getOwner(), parsed.data);
    return NextResponse.json(stop, { status: 201 });
  } catch {
    return NextResponse.json({ error: "leg not found" }, { status: 404 });
  }
}
