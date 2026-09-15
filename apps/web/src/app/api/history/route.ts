import { NextResponse } from "next/server";
import { z } from "zod";
import { changeEntity } from "@rv-trip/core";
import type { ChangeHistoryRow } from "@rv-trip/core";
import { listChangeHistory } from "@rv-trip/db";
import { describePeople } from "@/lib/members";
import { getOwner } from "@/lib/owner";

/**
 * `GET /api/history?entity=stop&id=<uuid>` — the audit behind an opened byline
 * (#78 · docs/design/81 §6). At most five rows, newest first, each
 * `{ field, from, to, memberName, at }`.
 *
 * It is a SECOND read on purpose: the glance answer ("rated by Jess · Sep 12")
 * already rides along on the list read as `lastChange`, so the old→new list is
 * fetched only when someone actually taps the line.
 *
 * WHICH household is never the caller's to name — it comes from `getOwner()`,
 * the seam every other route is scoped by. An entity outside it 404s rather
 * than answering an empty list, so the reply can never confirm that another
 * household's id exists.
 */
const historyQuery = z.object({
  entity: changeEntity,
  // A non-uuid would reach a `uuid` column and fail at the DRIVER (a 500), so
  // it is refused here — the same reasoning as api/places/[id]'s `placeId`.
  // A query string is a request, though, so a malformed one is a 400: the 404
  // is reserved for a well-formed id that is simply not this household's.
  id: z.string().uuid(),
});

/** How many rows the popover shows before "older changes aren't kept". */
const HISTORY_LIMIT = 5;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const parsed = historyQuery.safeParse({
    entity: params.get("entity") ?? undefined,
    id: params.get("id") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rows = await listChangeHistory(
    await getOwner(),
    parsed.data.entity,
    parsed.data.id,
    HISTORY_LIMIT,
  );
  if (rows === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  // `change_log` stores WHO as a member id; the popover shows a person. This is
  // the one place in the app that asks the identity provider, and it is
  // forgiving by design (keyless — walks, the whole route suite — it asks
  // nobody and the id stands in for the name).
  const people = await describePeople([...new Set(rows.map((r) => r.memberId))]);
  const named: ChangeHistoryRow[] = rows.map(({ memberId, ...r }) => ({
    ...r,
    memberName: people[memberId]?.name || memberId,
  }));
  return NextResponse.json(named);
}
