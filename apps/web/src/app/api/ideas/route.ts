import { NextResponse } from "next/server";
import { ideaCreateInput } from "@rv-trip/core";
import { createIdea } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Add idea" — appended to the end of its stop's list; the client never picks a
 * sortOrder. 201 carries the core `Idea` shape so the sheet can splice it into
 * the tree it already holds.
 *
 * The body also carries `status`, `rating` and `notes` because this is what an
 * undone DELETE re-POSTs: a promoted-to-"planned" idea has to come back the way
 * it left, not as a fresh maybe. An insert has no WHERE to match zero rows, so
 * the parent stop is proved explicitly and a foreign one reads as 404.
 */
export async function POST(req: Request) {
  const parsed = ideaCreateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const idea = await createIdea(getOwner(), parsed.data);
    return NextResponse.json(idea, { status: 201 });
  } catch {
    return NextResponse.json({ error: "stop not found" }, { status: 404 });
  }
}
