import type {
  ReservationType,
  IdeaStatus,
  IsoDate,
  LatLng,
  PlacesEnvelope,
  RigProfileInput,
} from "@rv-trip/core";
import type { RouteMap } from "./trip-logic";

async function req(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const tripApi = {
  updateStop: (
    id: string,
    patch: {
      rating?: number | null;
      notes?: string | null;
      arriveDate?: IsoDate | null;
      departDate?: IsoDate | null;
    },
  ) => req(`/api/stops/${id}`, "PATCH", patch),

  createReservation: (input: {
    stopId: string;
    type: ReservationType;
    name: string;
    cost: number | null;
    checkIn: IsoDate | null;
  }) => req(`/api/reservations`, "POST", input),

  updateReservation: (id: string, patch: { rating?: number | null; notes?: string | null }) =>
    req(`/api/reservations/${id}`, "PATCH", patch),

  updateIdea: (
    id: string,
    patch: { status?: IdeaStatus; rating?: number | null; notes?: string | null },
  ) => req(`/api/ideas/${id}`, "PATCH", patch),

  promoteIdea: (id: string) => req(`/api/ideas/${id}/promote`, "POST"),

  reorderLeg: (legId: string, order: string[]) =>
    req(`/api/legs/${legId}/reorder`, "POST", { order }),

  /** The rig is a singleton at a fixed URL, so saving it is a PUT upsert. */
  saveRig: (input: RigProfileInput) => req(`/api/rig`, "PUT", input),

  /**
   * Route pairs the server never saw — the post-reorder upgrade. The reply
   * echoes the rig hash it keyed with, so the caller can tell "these are keyed
   * for your rig" from "the rig changed under you".
   */
  routePairs: (
    pairs: { from: LatLng; to: LatLng }[],
  ): Promise<{ rigHash: string; routes: RouteMap }> =>
    req(`/api/routes`, "POST", { pairs }) as Promise<{ rigHash: string; routes: RouteMap }>,

  /**
   * Place search for the picker (docs/design/41 §3). Deliberately NOT through
   * `req`: the throttled answer is a 429 whose body is the real, renderable
   * degraded envelope (`places-search.ts:placesEnvelopeStatus`), and `req`
   * throws on !ok. Any other failure — offline, a proxy, a non-JSON body — is
   * reported as the same degraded shape, so the picker has exactly one shape
   * to render and never a thrown error to catch.
   */
  searchPlaces: async (q: string, near?: LatLng | null): Promise<PlacesEnvelope> => {
    const params = new URLSearchParams({ q });
    if (near) params.set("near", `${near.lat},${near.lng}`);
    try {
      const res = await fetch(`/api/places/search?${params}`);
      const body = (await res.json()) as PlacesEnvelope;
      if (!Array.isArray(body?.results)) throw new Error("not an envelope");
      return body;
    } catch {
      return { results: [], degraded: true, reason: "upstream_error" };
    }
  },
};
