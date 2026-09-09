import { NextResponse } from "next/server";
import { detailsPlacesEnvelope, googlePlaceIdSchema, placesEnvelopeStatus } from "@rv-trip/core";
import { placesProvider } from "@/lib/places";

/**
 * GET /api/places/details/ChIJvT2R… — one call per pick, on the SAME envelope
 * as search (docs/design/41 §3), so the picker has one shape to render and "no
 * key" is a normal 200 with `results: []`.
 *
 * Not rate limited: a pick is not a keystroke. An id Google has retired comes
 * back as `{ results: [], degraded: false }` — we asked, and there is nothing
 * there. The logic is unit tested in packages/core's `detailsPlacesEnvelope`.
 *
 * §3 draws a `sessionToken` echoed from search onto this call. It is not
 * implemented and takes no query parameter: a session token is a Google
 * Autocomplete↔Details pairing, and the search leg is `places:searchText`,
 * which is billed per request and accepts none. Flagged in i1, still undecided.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = googlePlaceIdSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { provider, configured } = placesProvider();
  const envelope = await detailsPlacesEnvelope({
    provider,
    configured,
    googlePlaceId: parsed.data,
  });
  return NextResponse.json(envelope, { status: placesEnvelopeStatus(envelope) });
}
