import { describe, it, expect } from "vitest";
import {
  buildRoutesUrl,
  hereCredentialsFromEnv,
  parseRouteResponse,
  rfc3986,
  signTokenRequest,
} from "./here";
import { feetInchesToMeters, poundsToKilograms } from "../domain/rig";

const RIG = {
  name: "Sunseeker 2450",
  type: "motorhome" as const,
  heightMeters: feetInchesToMeters(11, 6),
  widthMeters: feetInchesToMeters(8, 4),
  lengthMeters: feetInchesToMeters(26, 0),
  grossWeightKg: poundsToKilograms(14_500),
  propaneOnBoard: true,
};

const NEWPORT = { lat: 44.6365, lng: -124.053 };
const BEND = { lat: 44.0582, lng: -121.3153 };

// NOTE: no live HERE call was made from this worktree. These tests pin the
// request we build and the mapping we apply to a response shaped like the
// vendor's; whether HERE accepts them is the walk's job.

describe("hereCredentialsFromEnv", () => {
  it("is null unless all three OAuth values are present (the local case)", () => {
    expect(hereCredentialsFromEnv({})).toBeNull();
    expect(hereCredentialsFromEnv({ HERE_ACCESS_KEY_ID: "a" })).toBeNull();
    expect(
      hereCredentialsFromEnv({
        HERE_ACCESS_KEY_ID: "a",
        HERE_ACCESS_KEY_SECRET: "b",
        HERE_TOKEN_ENDPOINT: "https://example.test/token",
      }),
    ).toEqual({ accessKeyId: "a", accessKeySecret: "b", tokenEndpoint: "https://example.test/token" });
  });
});

describe("buildRoutesUrl", () => {
  const url = () => new URL(buildRoutesUrl(NEWPORT, BEND, RIG));

  it("asks for a truck route with the polyline and the notice spans", () => {
    const p = url().searchParams;
    expect(p.get("transportMode")).toBe("truck");
    expect(p.get("origin")).toBe("44.6365,-124.053");
    expect(p.get("destination")).toBe("44.0582,-121.3153");
    expect(p.get("return")).toBe("polyline,summary");
    expect(p.get("spans")).toBe("notices,names");
  });

  it("sends whole centimetres and kilograms, rounded UP", () => {
    const p = url().searchParams;
    expect(p.get("vehicle[height]")).toBe("351");
    expect(p.get("vehicle[width]")).toBe("254");
    expect(p.get("vehicle[length]")).toBe("793");
    expect(p.get("vehicle[grossWeight]")).toBe("6578");
  });

  it("declares propane as flammable hazardous goods only when it is on board", () => {
    expect(url().searchParams.get("vehicle[shippedHazardousGoods]")).toBe("flammable");
    const dry = new URL(buildRoutesUrl(NEWPORT, BEND, { ...RIG, propaneOnBoard: false }));
    expect(dry.searchParams.has("vehicle[shippedHazardousGoods]")).toBe(false);
  });

  it("sends no vehicle at all when there is no rig", () => {
    const none = new URL(buildRoutesUrl(NEWPORT, BEND, null));
    expect([...none.searchParams.keys()].some((k) => k.startsWith("vehicle"))).toBe(false);
  });
});

describe("signTokenRequest", () => {
  const creds = {
    accessKeyId: "key-id",
    accessKeySecret: "key-secret",
    tokenEndpoint: "https://account.api.here.com/oauth2/token",
  };

  it("is a deterministic HMAC-SHA256 OAuth header for a fixed nonce and clock", async () => {
    const a = await signTokenRequest(creds, () => 1_757_000_000_000, () => "nonce123");
    const b = await signTokenRequest(creds, () => 1_757_000_000_000, () => "nonce123");
    expect(a).toBe(b);
    expect(a).toContain('oauth_signature_method="HMAC-SHA256"');
    expect(a).toContain('oauth_consumer_key="key-id"');
    expect(a).toContain('oauth_timestamp="1757000000"');
    expect(a).toContain('oauth_version="1.0"');
    expect(a).toMatch(/oauth_signature="[^"]+"/);
  });

  it("never leaks the secret into the header", async () => {
    const header = await signTokenRequest(creds, () => 1, () => "n");
    expect(header).not.toContain("key-secret");
  });

  it("signs differently when the secret changes", async () => {
    const a = await signTokenRequest(creds, () => 1, () => "n");
    const b = await signTokenRequest({ ...creds, accessKeySecret: "other" }, () => 1, () => "n");
    expect(a).not.toBe(b);
  });

  it("percent-encodes per RFC 3986, not per encodeURIComponent", () => {
    expect(rfc3986("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });
});

describe("parseRouteResponse", () => {
  const body = {
    routes: [
      {
        sections: [
          {
            summary: { duration: 16_260, length: 305_775 },
            polyline: "BG0zqrxCk3",
            spans: [
              { offset: 0, names: [{ value: "US-12" }], notices: [0] },
              { offset: 12, names: [{ value: "OR-22" }], notices: [1] },
              { offset: 30, names: [{ value: "OR-22" }] },
            ],
            notices: [
              {
                code: "violatedVehicleRestriction",
                details: [{ causes: [{ type: "height", value: 3.35 }] }],
              },
              { code: "hazmatRestriction", details: [{ causes: [{ type: "hazardousGoods" }] }] },
            ],
          },
        ],
      },
    ],
  };

  it("maps the summary and tags the source as the vendor's", () => {
    const result = parseRouteResponse(body, RIG);
    expect(result.durationSeconds).toBe(16_260);
    expect(result.distanceMeters).toBe(305_775);
    expect(result.source).toBe("here");
    expect(result.polyline).toBe("BG0zqrxCk3");
  });

  it("names the road the drive mostly runs on", () => {
    expect(parseRouteResponse(body, RIG).primaryRoad).toBe("OR-22");
  });

  it("composes the design's notice copy from the vendor's codes and spans", () => {
    const notices = parseRouteResponse(body, RIG).notices;
    expect(notices).toHaveLength(2);
    expect(notices[0]!.kind).toBe("height");
    expect(notices[0]!.roadName).toBe("US-12");
    expect(notices[0]!.limitMeters).toBe(3.35);
    expect(notices[0]!.message).toBe("Avoids the US-12 tunnel — 11′0″ clearance, your rig is 11′6″.");
    expect(notices[1]!.kind).toBe("propane");
    expect(notices[1]!.message).toBe("Propane on board — the OR-22 tunnel is bypassed.");
  });

  it("empty is the normal case", () => {
    const clean = {
      routes: [{ sections: [{ summary: { duration: 11_520, length: 218_866 }, polyline: "BG" }] }],
    };
    expect(parseRouteResponse(clean, RIG).notices).toEqual([]);
  });

  it("throws on a body with no route, so the caller degrades to the estimate", () => {
    expect(() => parseRouteResponse({ routes: [] }, RIG)).toThrow();
    expect(() => parseRouteResponse({}, RIG)).toThrow();
  });
});
