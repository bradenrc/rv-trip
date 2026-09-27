import type { z } from "zod";
import type {
  IsoDate,
  Idea,
  IdeaCreateInput,
  IdeaStatus,
  NearbySaves,
  Reservation,
  SavedPlace,
  SavedPlaceCreateInput,
  SavedPlacePatch,
  ReservationCreateBody,
  SegmentPatchInput,
  Trip,
  TripCreateInput,
  TripPatchInput,
  TripSummary,
} from "../domain/types";
import type { RigProfile, RigProfileInput } from "../domain/rig";
import type { LatLng, ResolvedDestination, RouteResult } from "../providers/index";
import {
  tripBundleSchema,
  tripSummaryListSchema,
  nearbySavesSchema,
  ideaSchema,
  savedPlaceListSchema,
  savedPlaceSchema,
  placesEnvelopeSchema,
  resolvedDestinationSchema,
  rigResponseSchema,
  routePairsResponseSchema,
  reservationRowSchema,
  tripSchema,
  type PlacesSearchEnvelope,
  type TripBundle,
} from "./schemas";

export * from "./schemas";

/**
 * The typed client for the REST API — the one contract the web and native
 * apps share (spec: `packages/core/api-client`, issue #31 C1).
 *
 * - Global `fetch` only; no Node imports, so it runs in the browser, in React
 *   Native, and in a Next server component alike.
 * - Every response is validated against a Zod schema; drift throws.
 * - Auth is a seam: `getAuthHeader` returns the `Authorization` value (Clerk
 *   session JWT, issue #33) or null for the local dev-user API.
 * - No retries, no caching: the screen decides.
 */

export interface ApiClientOptions {
  /** e.g. "http://localhost:3000" — no trailing slash. */
  baseUrl: string;
  /** Override for tests or for a runtime with a custom fetch. */
  fetch?: typeof fetch;
  /** Returns the `Authorization` header value, or null to send none. */
  getAuthHeader?: () => Promise<string | null> | string | null;
}

/**
 * A session token source — Clerk's `getToken()` on the phone, or anything that
 * can answer with a JWT. `null` / `undefined` / `""` all mean "no session".
 */
export type TokenGetter = () => Promise<string | null | undefined> | string | null | undefined;

/**
 * Builds the `getAuthHeader` seam out of a token getter (issue #44).
 *
 * The keyless promise lives here: with no getter — or a getter with nothing to
 * hand back — this resolves `null`, `request()` sets no `Authorization` header
 * at all, and the API serves the local `dev-user`. With a session it is
 * `Bearer <jwt>`, the contract `apps/web/src/proxy.ts` documents for the
 * native client.
 *
 * The getter is asked on every request, never cached, so a rotated session
 * token is picked up without rebuilding the client. A getter that throws (an
 * offline token refresh) degrades to `null` rather than failing the read — the
 * server's 401 is the loud signal, not a thrown refresh.
 */
export function bearerAuthHeader(getToken: TokenGetter | null | undefined): () => Promise<string | null> {
  return async () => {
    try {
      const token = await getToken?.();
      return token ? `Bearer ${token}` : null;
    } catch {
      return null;
    }
  };
}

/** A non-2xx response. `body` is the parsed JSON when there was any. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status}`);
    this.name = "ApiError";
  }
}

export interface StopPatch {
  rating?: number | null;
  notes?: string | null;
  arriveDate?: IsoDate | null;
  departDate?: IsoDate | null;
}
export interface ReservationPatch {
  rating?: number | null;
  notes?: string | null;
}
export interface IdeaPatch {
  status?: IdeaStatus;
  rating?: number | null;
  notes?: string | null;
}
/**
 * `POST /api/reservations` — core's own create grammar, pre-parse: a stop OR a
 * segment parent, the clock a flight carries, a stay's kind, and `moveStop`
 * (vet HIGH: this used to be a five-field subset that could not carry a
 * flight). A 409 `segment_date_mismatch` throws `ApiError` with its body.
 */
export type CreateReservationInput = ReservationCreateBody;

export interface ApiClient {
  trips: {
    list(): Promise<TripSummary[]>;
    get(id: string): Promise<TripBundle>;
    /** POST /api/trips → 201 Trip — the setup screen (#103). */
    create(input: TripCreateInput): Promise<Trip>;
    /** PATCH /api/trips/:id → 204. The review sheet's radius chips send
     * `{ surfaceRadiusMi }` (#111 i3). */
    patch(id: string, patch: TripPatchInput): Promise<void>;
    /** The saves near this trip, at the trip's own radius (#111 i3). */
    nearbySaves(id: string): Promise<NearbySaves>;
    /** The banner's Dismiss: remember these saves as dismissed for this trip. */
    dismissSaves(id: string, saveIds: string[]): Promise<void>;
  };
  places: {
    list(): Promise<SavedPlace[]>;
    /** POST /api/places. 201 new or 200 on a replayed `clientId` — the same
     * row either way (#111). A non-2xx throws `ApiError` with its status, which
     * is what the phone's capture queue keeps or drops on. */
    create(body: SavedPlaceCreateInput): Promise<SavedPlace>;
    /** The shipped search proxy. A throttled 429 still answers the degraded
     * envelope rather than throwing — its body IS that envelope. */
    search(q: string, near?: LatLng): Promise<PlacesSearchEnvelope>;
    /** PATCH /api/places/:id → 204. On the Saves tab (#111 i2) it carries
     * `{ upgradeToSuggested: true }` (tap the strip) or `{ suggestedPlace: null }`
     * (Dismiss). No body comes back: refetch `list()` for the re-resolved
     * destination. */
    patch(id: string, patch: SavedPlacePatch): Promise<void>;
    /** DELETE /api/places/:id — the capture toast's Undo. */
    remove(id: string): Promise<void>;
  };
  destinations: {
    /** The locality a point is in, or null (#111). */
    resolve(near: LatLng): Promise<ResolvedDestination | null>;
  };
  rig: {
    get(): Promise<RigProfile | null>;
    save(input: RigProfileInput): Promise<RigProfile>;
  };
  stops: {
    patch(id: string, patch: StopPatch): Promise<void>;
  };
  segments: {
    /** PATCH /api/segments/:id → 204 — a hop's mode switch (#104). */
    patch(id: string, patch: SegmentPatchInput): Promise<void>;
  };
  reservations: {
    create(input: CreateReservationInput): Promise<Reservation>;
    patch(id: string, patch: ReservationPatch): Promise<void>;
  };
  ideas: {
    /** POST /api/ideas → 201 Idea. The review sheet's Add copies a save
     * (`nearbyIdeaBody`, #111 i3). */
    create(input: IdeaCreateInput): Promise<Idea>;
    patch(id: string, patch: IdeaPatch): Promise<void>;
    promote(id: string): Promise<Reservation>;
  };
  legs: {
    reorder(legId: string, order: string[]): Promise<void>;
  };
  routes: {
    pairs(
      pairs: { from: LatLng; to: LatLng }[],
    ): Promise<{ routingHash: string; routes: Record<string, RouteResult> }>;
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const auth = await options.getAuthHeader?.();
    if (auth) headers.authorization = auth;

    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) return null;
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) throw new ApiError(res.status, method, path, json);
    return json;
  }

  const parsed = async <T extends z.ZodTypeAny>(schema: T, p: Promise<unknown>): Promise<z.infer<T>> =>
    schema.parse(await p);

  const voidResult = async (p: Promise<unknown>): Promise<void> => {
    await p;
  };

  return {
    trips: {
      list: () => parsed(tripSummaryListSchema, request("GET", "/api/trips")),
      get: (id) => parsed(tripBundleSchema, request("GET", `/api/trips/${encodeURIComponent(id)}`)),
      create: (input) => parsed(tripSchema, request("POST", "/api/trips", input)),
      patch: (id, patch) => voidResult(request("PATCH", `/api/trips/${encodeURIComponent(id)}`, patch)),
      nearbySaves: (id) =>
        parsed(nearbySavesSchema, request("GET", `/api/trips/${encodeURIComponent(id)}/nearby-saves`)),
      dismissSaves: (id, saveIds) =>
        voidResult(
          request("POST", `/api/trips/${encodeURIComponent(id)}/dismissed-saves`, { saveIds }),
        ),
    },
    places: {
      list: () => parsed(savedPlaceListSchema, request("GET", "/api/places")),
      create: (body) => parsed(savedPlaceSchema, request("POST", "/api/places", body)),
      search: async (q, near) => {
        const qs = new URLSearchParams({ q });
        if (near) qs.set("near", `${near.lat},${near.lng}`);
        try {
          return await parsed(placesEnvelopeSchema, request("GET", `/api/places/search?${qs}`));
        } catch (e) {
          if (e instanceof ApiError && e.status === 429) return placesEnvelopeSchema.parse(e.body);
          throw e;
        }
      },
      patch: (id, patch) =>
        voidResult(request("PATCH", `/api/places/${encodeURIComponent(id)}`, patch)),
      remove: (id) => voidResult(request("DELETE", `/api/places/${encodeURIComponent(id)}`)),
    },
    destinations: {
      resolve: (near) =>
        parsed(
          resolvedDestinationSchema,
          request("GET", `/api/destinations/resolve?near=${near.lat},${near.lng}`),
        ),
    },
    rig: {
      get: () => parsed(rigResponseSchema, request("GET", "/api/rig")),
      save: async (input) => {
        const rig = await parsed(rigResponseSchema, request("PUT", "/api/rig", input));
        if (!rig) throw new ApiError(500, "PUT", "/api/rig", null);
        return rig;
      },
    },
    stops: {
      patch: (id, patch) => voidResult(request("PATCH", `/api/stops/${encodeURIComponent(id)}`, patch)),
    },
    segments: {
      patch: (id, patch) =>
        voidResult(request("PATCH", `/api/segments/${encodeURIComponent(id)}`, patch)),
    },
    reservations: {
      create: (input) => parsed(reservationRowSchema, request("POST", "/api/reservations", input)),
      patch: (id, patch) =>
        voidResult(request("PATCH", `/api/reservations/${encodeURIComponent(id)}`, patch)),
    },
    ideas: {
      create: (input) => parsed(ideaSchema, request("POST", "/api/ideas", input)),
      patch: (id, patch) => voidResult(request("PATCH", `/api/ideas/${encodeURIComponent(id)}`, patch)),
      promote: (id) =>
        parsed(reservationRowSchema, request("POST", `/api/ideas/${encodeURIComponent(id)}/promote`)),
    },
    legs: {
      reorder: (legId, order) =>
        voidResult(request("POST", `/api/legs/${encodeURIComponent(legId)}/reorder`, { order })),
    },
    routes: {
      pairs: (pairs) => parsed(routePairsResponseSchema, request("POST", "/api/routes", { pairs })),
    },
  };
}
