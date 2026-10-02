import type { LatLng, ResolvedArea } from "@rv-trip/core";

/**
 * The web capture's area label (#111 i4 · docs/design/111 "Web parity"). The
 * shipped picker's free-text escape row saves an AREA note; its label is the
 * locality the browser is in, when the browser will say where that is.
 *
 * Both halves are injected so every branch is testable without a browser or a
 * network; `browserAreaLabel` below is the wiring. Any failure — geolocation
 * refused or unavailable, the resolver offline, no key, no locality within
 * 25 mi — is a null label, never a failed save: the server then falls back to
 * the row's region (createSave).
 */
export async function areaLabelNear(
  getPosition: () => Promise<LatLng | null>,
  resolve: (near: LatLng) => Promise<ResolvedArea | null>,
): Promise<string | null> {
  try {
    const here = await getPosition();
    if (!here) return null;
    const area = await resolve(here);
    return area?.name ?? null;
  } catch {
    return null;
  }
}

/** The browser's position, or null — refused, unsupported, or too slow. */
export function browserPosition(): Promise<LatLng | null> {
  return new Promise((done) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return done(null);
    navigator.geolocation.getCurrentPosition(
      (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => done(null),
      // A town is all this names, so a coarse, cached fix is plenty.
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 10_000 },
    );
  });
}

/** `GET /api/areas/resolve?near=lat,lng` — the area or null. */
export async function resolveAreaNear(near: LatLng): Promise<ResolvedArea | null> {
  const res = await fetch(`/api/areas/resolve?near=${near.lat},${near.lng}`);
  if (!res.ok) return null;
  return (await res.json()) as ResolvedArea | null;
}

/** The escape row's label, from the browser: geolocation, then the resolver. */
export function browserAreaLabel(): Promise<string | null> {
  return areaLabelNear(browserPosition, resolveAreaNear);
}
