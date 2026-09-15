import { NextResponse } from "next/server";
import { ideaCreateInput } from "@rv-trip/core";
import { createIdea } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Add idea" — appended to the end of the list it joins (its stop's, or the
 * trip's SHELF when `stopId` is null); the client never picks a sortOrder. 201
 * carries the core `Idea` shape so the screen can splice it into the tree it
 * already holds.
 *
 * The body also carries `status`, `rating` and `notes` because this is what an
 * undone DELETE re-POSTs: a promoted-to-"planned" idea has to come back the way
 * it left, not as a fresh maybe.
 *
 * An insert has no WHERE to match zero rows, so the parent is proved
 * explicitly. #80 makes that parent the TRIP — always, because `stopId` may be
 * null and an idea is owner-scoped through `trip_id` either way — and the stop
 * as well when one is sent. The 404 says which of the two was not found rather
 * than answering "stop not found" to a body that named no stop.
 */
export async function POST(req: Request) {
  const parsed = ideaCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const idea = await createIdea(await getOwner(), parsed.data);
    return NextResponse.json(idea, { status: 201 });
  } catch (e) {
    const error = e instanceof Error && e.message === "trip not found" ? e.message : "stop not found";
    return NextResponse.json({ error }, { status: 404 });
  }
}
