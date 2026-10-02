import { NextResponse } from "next/server";
import { areaResolveQuerySchema, type ResolvedArea } from "@rv-trip/core";
import { placesProvider } from "@/lib/places";

/**
 * GET /api/areas/resolve?near=9.9325,-84.0521 (#111) — what locality a
 * point is in, for the capture sheet's note row ("in San José area · where you
 * are"). Online only; the phone never blocks a save on it.
 *
 * Answers the area (`name`, `region`, `googlePlaceId`, and the
 * locality's point) or `null`: no locality within 25 mi, no GOOGLE_API_KEY (the
 * stub), or Google failed. A hint that failed is still a 200 — the note row
 * falls back to "in the area you're in", it does not error.
 *
 * Nothing is written: the areas row is upserted only when a save lands
 * (`createSave`). Auth is the proxy's, like every `/api/*` route.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const parsed = areaResolveQuerySchema.safeParse({ near: params.get("near") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { lat, lng } = parsed.data.near;
  let area: ResolvedArea | null = null;
  try {
    area = await placesProvider().provider.resolveArea(lat, lng);
  } catch {
    area = null;
  }
  return NextResponse.json(area);
}
