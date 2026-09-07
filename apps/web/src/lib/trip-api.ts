import type {
  ReservationType,
  IdeaStatus,
  IsoDate,
  LatLng,
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

  /** Route pairs the server never saw — the post-reorder upgrade. */
  routePairs: (pairs: { from: LatLng; to: LatLng }[]): Promise<RouteMap> =>
    req(`/api/routes`, "POST", { pairs }) as Promise<RouteMap>,
};
