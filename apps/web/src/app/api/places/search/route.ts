import { NextResponse } from "next/server";
import {
  OwnerTokenBucket,
  placesEnvelopeStatus,
  placesSearchQuerySchema,
  searchPlacesEnvelope,
} from "@rv-trip/core";
import { getOwner } from "@/lib/owner";
import { placesProvider } from "@/lib/places";

/**
 * GET /api/places/search?q=kalaloch&near=47.61,-124.38 — docs/design/41 §3.
 *
 * Healthy and degraded answer on ONE envelope, so the picker renders one shape
 * and "no key" is a normal 200 with `reason: "no_provider"` rather than an
 * error status. The only non-200 is the throttled 429, whose BODY is still the
 * same degraded envelope — a throttled user sees the free-text escape row, not
 * a red toast.
 *
 * The decision tree itself lives in `searchPlacesEnvelope`
 * (packages/core/src/providers/places-search.ts), which is where it is unit
 * tested; this handler is the adapter.
 *
 * Owner scoping via getOwner() exactly like api/routes/route.ts: the caller
 * identifies itself, never the request body.
 */

/**
 * The per-owner token bucket, in this route module's scope — 30 searches / 60 s.
 * Correct for one instance; a multi-instance deploy would need a shared store.
 * Recorded as accepted, not solved, in §"Dev notes".
 */
const limiter = new OwnerTokenBucket();

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const parsed = placesSearchQuerySchema.safeParse({
    q: params.get("q") ?? undefined,
    near: params.get("near") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { provider, configured } = placesProvider();
  const envelope = await searchPlacesEnvelope({
    provider,
    configured,
    owner: await getOwner(),
    query: parsed.data.q,
    near: parsed.data.near,
    limiter,
  });
  return NextResponse.json(envelope, { status: placesEnvelopeStatus(envelope) });
}
