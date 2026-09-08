import {
  metersToVendorCm,
  kilogramsToVendorKg,
  type RigProfileInput,
} from "../domain/rig";
import {
  estimateRoute,
  type LatLng,
  type RouteNotice,
  type RouteResult,
  type RoutingProvider,
} from "./index";
import { composeNoticeMessage, noticeKind, type NoticeKind } from "./notices";

/**
 * HERE truck routing — SERVER SIDE ONLY.
 *
 * Deliberately NOT re-exported from providers/index.ts: this file holds
 * credentials and `fetch`, and must never be pulled into a client bundle.
 * Import it by its subpath (`@rv-trip/core/providers/here`) from server code.
 *
 * EXERCISED AGAINST LIVE HERE on 2026-09-07: the signed `client_credentials`
 * grant, `transportMode=truck` with `vehicle[*]` in cm/kg,
 * `shippedHazardousGoods=flammable`, `spans=notices,names`, and a real
 * `violatedVehicleRestriction` notice all round-trip. The notice DETAIL shape
 * was the one thing the docs got wrong for us — see `HereDetail` below.
 *
 * Every failure path still degrades to `estimateRoute` and renders as the
 * neutral "estimate" state rather than surfacing an error: a trip you cannot
 * open is worse than a drive time you cannot trust.
 */

const ROUTES_URL = "https://router.hereapi.com/v8/routes";

export interface HereCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  tokenEndpoint: string;
}

/** Reads the three HERE OAuth values; null when any is missing (the local case). */
export function hereCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): HereCredentials | null {
  const accessKeyId = env.HERE_ACCESS_KEY_ID;
  const accessKeySecret = env.HERE_ACCESS_KEY_SECRET;
  const tokenEndpoint = env.HERE_TOKEN_ENDPOINT;
  if (!accessKeyId || !accessKeySecret || !tokenEndpoint) return null;
  return { accessKeyId, accessKeySecret, tokenEndpoint };
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export class HereRoutingProvider implements RoutingProvider {
  /** ONE grant per process, refreshed on expiry or on a 401 — never per call. */
  private token: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly credentials: HereCredentials) {}

  async route(from: LatLng, to: LatLng, rig?: RigProfileInput | null): Promise<RouteResult> {
    try {
      return await this.routeOnce(from, to, rig ?? null, false);
    } catch {
      // Any vendor failure — grant rejected, 5xx, malformed body, network —
      // falls to the straight-line estimate, honestly tagged.
      return estimateRoute(from, to);
    }
  }

  private async routeOnce(
    from: LatLng,
    to: LatLng,
    rig: RigProfileInput | null,
    isRetry: boolean,
  ): Promise<RouteResult> {
    const token = await this.bearer();
    const res = await fetch(buildRoutesUrl(from, to, rig), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && !isRetry) {
      this.token = null;
      return this.routeOnce(from, to, rig, true);
    }
    if (!res.ok) throw new Error(`HERE /v8/routes → ${res.status}`);
    return parseRouteResponse(await res.json(), rig);
  }

  private async bearer(): Promise<string> {
    const cached = this.token;
    if (cached && cached.expiresAtMs > Date.now()) return cached.token;
    // Collapse concurrent misses onto a single grant.
    this.inflight ??= this.grant().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async grant(): Promise<string> {
    const { tokenEndpoint } = this.credentials;
    const body = "grant_type=client_credentials";
    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Authorization: await signTokenRequest(this.credentials),
      },
      body,
    });
    if (!res.ok) throw new Error(`HERE token grant → ${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("HERE token grant returned no access_token");
    // expires_in is ~86399s; refresh a minute early rather than on the cliff.
    const ttlMs = Math.max(60, (json.expires_in ?? 86_399) - 60) * 1000;
    this.token = { token: json.access_token, expiresAtMs: Date.now() + ttlMs };
    return json.access_token;
  }
}

/**
 * HERE's token endpoint takes an OAuth 1.0-style HMAC-SHA256 signature over the
 * request rather than a plain API key — this org's REST API keys never
 * activate (verified 2026-09-07, see .env.example).
 */
export async function signTokenRequest(
  credentials: HereCredentials,
  now: () => number = Date.now,
  nonceSource: () => string = () => Math.random().toString(36).slice(2, 14),
): Promise<string> {
  const params: Record<string, string> = {
    grant_type: "client_credentials",
    oauth_consumer_key: credentials.accessKeyId,
    oauth_nonce: nonceSource(),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(Math.floor(now() / 1000)),
    oauth_version: "1.0",
  };
  const normalized = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k]!)}`)
    .join("&");
  const baseString = ["POST", rfc3986(credentials.tokenEndpoint), rfc3986(normalized)].join("&");
  const signature = await hmacSha256Base64(`${credentials.accessKeySecret}&`, baseString);

  const header = { ...params, oauth_signature: signature };
  delete (header as Record<string, string>).grant_type;
  return `OAuth ${Object.keys(header)
    .sort()
    .map((k) => `${rfc3986(k)}="${rfc3986(header[k as keyof typeof header]!)}"`)
    .join(",")}`;
}

export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * The truck query. Dimensions go over the wire in whole centimetres and whole
 * kilograms, ALWAYS rounded up — a rig reported one centimetre short is a rig
 * routed under a bridge it does not clear.
 */
export function buildRoutesUrl(from: LatLng, to: LatLng, rig: RigProfileInput | null): string {
  const params = new URLSearchParams({
    transportMode: "truck",
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    return: "polyline,summary",
    spans: "notices,names",
  });
  if (rig) {
    params.set("vehicle[height]", String(metersToVendorCm(rig.heightMeters)));
    params.set("vehicle[width]", String(metersToVendorCm(rig.widthMeters)));
    params.set("vehicle[length]", String(metersToVendorCm(rig.lengthMeters)));
    params.set("vehicle[grossWeight]", String(kilogramsToVendorKg(rig.grossWeightKg)));
    if (rig.propaneOnBoard) params.set("vehicle[shippedHazardousGoods]", "flammable");
  }
  return `${ROUTES_URL}?${params.toString()}`;
}

// ── response mapping ───────────────────────────────────────────────────────
interface HereSpan {
  offset?: number;
  names?: { value?: string }[];
  notices?: number[];
}
interface HereCause {
  code?: string;
  type?: string;
  /** The road's limit, in metres, when the vendor states one. */
  value?: number;
}
/**
 * A notice detail as HERE actually sends it (captured live 2026-09-07,
 * Manhattan → Newark, an over-height/over-weight rig):
 *
 *   { type: "restriction",
 *     cause: "Route violates vehicle restriction: current weight limit of 2721 kg",
 *     maxGrossWeight: 2721, maxWeight: { value: 2721, type: "current" } }
 *
 * So `cause` is PROSE, not a code, and the limit rides in a sibling `max*`
 * field — dimensions in metres, weights in kilograms. The nested `causes[]`
 * form is kept alongside it because the vendor is not uniform across notice
 * types, and a restriction we fail to classify is still one we must show.
 */
interface HereDetail extends HereCause {
  cause?: string;
  causes?: HereCause[];
  maxHeight?: number;
  maxWidth?: number;
  maxLength?: number;
  maxGrossWeight?: number;
  maxWeight?: { value?: number };
}
interface HereNotice {
  code?: string;
  title?: string;
  details?: HereDetail[];
}
interface HereSection {
  summary?: { duration?: number; length?: number };
  polyline?: string;
  spans?: HereSpan[];
  notices?: HereNotice[];
}

export function parseRouteResponse(body: unknown, rig: RigProfileInput | null): RouteResult {
  const sections = (body as { routes?: { sections?: HereSection[] }[] })?.routes?.[0]?.sections;
  if (!sections?.length) throw new Error("HERE returned no route");

  let durationSeconds = 0;
  let distanceMeters = 0;
  const notices: RouteNotice[] = [];
  const roadCounts = new Map<string, number>();

  for (const section of sections) {
    durationSeconds += section.summary?.duration ?? 0;
    distanceMeters += section.summary?.length ?? 0;
    for (const span of section.spans ?? []) {
      const name = span.names?.[0]?.value;
      if (name) roadCounts.set(name, (roadCounts.get(name) ?? 0) + 1);
    }
    for (const notice of section.notices ?? []) {
      notices.push(toRouteNotice(notice, roadForNotice(notice, section), rig));
    }
  }

  return {
    durationSeconds: Math.round(durationSeconds),
    distanceMeters: Math.round(distanceMeters),
    polyline: sections[0]?.polyline ?? null,
    primaryRoad: mostTravelled(roadCounts),
    source: "here",
    notices,
  };
}

/**
 * Which dimension the notice is about, and the vendor's limit for it.
 *
 * The `max*` fields are the authority when present — they are typed numbers,
 * and they say what the prose only implies. Everything else (the legacy
 * `causes[]` form, the prose `cause`, the notice title, the code itself) is
 * swept into one haystack for `noticeKind`, so an unrecognised shape still
 * lands on a dimension when the vendor named one anywhere.
 */
function classify(notice: HereNotice, detail: HereDetail | undefined) {
  const nested = detail?.causes?.[0];
  const dimensional: [NoticeKind, number | undefined][] = [
    ["height", detail?.maxHeight],
    ["width", detail?.maxWidth],
    ["length", detail?.maxLength],
  ];
  for (const [kind, meters] of dimensional) {
    if (typeof meters === "number") return { kind, limitMeters: meters, limitKilograms: null };
  }
  const kg = detail?.maxGrossWeight ?? detail?.maxWeight?.value;
  if (typeof kg === "number") return { kind: "weight" as const, limitMeters: null, limitKilograms: kg };

  const haystack = [nested?.type, nested?.code, detail?.cause, detail?.type, notice.title]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  const kind = noticeKind(notice.code ?? "", haystack || null);
  // The legacy nested form is the only one that carries a bare metre value.
  const value = typeof nested?.value === "number" ? nested.value : null;
  const isDimension = kind === "height" || kind === "width" || kind === "length";
  return { kind, limitMeters: isDimension ? value : null, limitKilograms: null };
}

function toRouteNotice(
  notice: HereNotice,
  roadName: string | null,
  rig: RigProfileInput | null,
): RouteNotice {
  const code = notice.code ?? "unknownRestriction";
  const { kind, limitMeters, limitKilograms } = classify(notice, notice.details?.[0]);
  return {
    code,
    kind,
    roadName,
    limitMeters,
    message: composeNoticeMessage({ kind, roadName, limitMeters, limitKilograms, rig }),
  };
}

/** The span a notice hangs off names the road it is about, when there is one. */
function roadForNotice(notice: HereNotice, section: HereSection): string | null {
  const index = section.notices?.indexOf(notice) ?? -1;
  if (index < 0) return null;
  const span = section.spans?.find((s) => s.notices?.includes(index));
  return span?.names?.[0]?.value ?? null;
}

function mostTravelled(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}
