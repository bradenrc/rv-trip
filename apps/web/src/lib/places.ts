import { StubPlacesProvider, type PlacesProvider } from "@rv-trip/core";
import {
  GooglePlacesProvider,
  googleCredentialsFromEnv,
} from "@rv-trip/core/providers/google-places";

/**
 * SERVER-SIDE ONLY. The Google key never leaves the server; the client only
 * ever talks to our own routes (docs/design/41 §3). This is the places twin of
 * lib/routing.ts, and resolves the provider exactly the same way.
 *
 * With no GOOGLE_API_KEY (the local case, and every pipeline stage) this
 * becomes StubPlacesProvider, which answers with an empty list. `configured`
 * carries WHY the list is empty so the route can say `no_provider` instead of
 * pretending Google looked and found nothing.
 */
export interface ResolvedPlacesProvider {
  provider: PlacesProvider;
  configured: boolean;
}

let cached: ResolvedPlacesProvider | null = null;

export function placesProvider(): ResolvedPlacesProvider {
  if (!cached) {
    const credentials = googleCredentialsFromEnv();
    cached = credentials
      ? { provider: new GooglePlacesProvider(credentials), configured: true }
      : { provider: new StubPlacesProvider(), configured: false };
  }
  return cached;
}

/**
 * #113 · the live destination resolver, as packages/db's `DestinationResolver`
 * — what the idea / stop / reservation handlers hand the Been write-through
 * (vet HIGH: without it every write-through save lands unanchored and the
 * "Last time here" card, which reads the destination point, never sees it).
 * The keyless stub resolves nothing, exactly as it does for `POST /api/places`.
 */
export function destinationResolver(): (lat: number, lng: number) => ReturnType<PlacesProvider["resolveDestination"]> {
  const { provider } = placesProvider();
  return (lat, lng) => provider.resolveDestination(lat, lng);
}
