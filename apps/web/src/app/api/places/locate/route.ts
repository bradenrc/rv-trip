import { NextResponse } from "next/server";
import { locatePlaces, locateRequestSchema } from "@rv-trip/core";
import { dbLocateStore } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { placesProvider } from "@/lib/places";

/**
 * POST /api/places/locate — the bounded coordinate backfill of docs/design/41
 * §3 and §6.
 *
 * The body is IDS ONLY: `{ rows: [{ kind, id }] }`, at most 25 per call. The
 * name and region that reach Google are re-read from the database under
 * `getOwner()` by `dbLocateStore`, so the client never sends a name and can
 * never make us geocode a row it does not own — which is also why
 * `UnmappedRow` (components/map/pins.ts) never had to widen.
 *
 * An oversized batch is a 400, not a silent truncation: the button slices to
 * the cap itself, and "located 25 of 40" over a batch that only looked at 25
 * would be a lie in a payload.
 *
 * A row Google cannot place is reported, never thrown — it comes back in
 * `stillUnmapped` and stays in the library, in the count, and pressable again.
 * The whole decision tree lives in `locatePlaces`
 * (packages/core/src/providers/places-locate.ts), where it is unit tested; this
 * handler is the adapter. `pnpm backfill:places` calls the same helper with the
 * same store.
 */
export async function POST(req: Request) {
  const parsed = locateRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = getOwner();
  const { provider } = placesProvider();
  const result = await locatePlaces({
    rows: parsed.data.rows,
    provider,
    store: dbLocateStore(owner),
  });
  return NextResponse.json(result);
}
