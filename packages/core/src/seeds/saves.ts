import type {
  ReservationType,
  SaveAnchor,
  SavedPlaceStatus,
  SuggestedPlace,
} from "../domain/types";

/**
 * The seeded Saves as PURE DATA (#111 i2), the same arrangement as the trips:
 * packages/db/src/seed.ts writes them, seeds.test.ts judges them. They are the
 * walk's Saves tab — the wireframe's Want to go list (Oregon 8, Costa Rica 1,
 * Unanchored 2 = 11) and its Been there 4.
 *
 * Destinations carry `seed_loc_*` ids in place of Google's locality place ids:
 * the seed runs with no key, and the unique (owner, google_place_id) only needs
 * them to be stable. A real capture of the same town on a keyed server writes
 * its own `ChIJ…` row beside them.
 */

export interface SeedDestination {
  /** Local key the saves point at. */
  key: string;
  googlePlaceId: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
}

export interface SeedSave {
  name: string;
  /** A `SeedDestination.key`, or null — Unanchored. */
  destination: string | null;
  anchor: SaveAnchor;
  areaLabel: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  type: ReservationType;
  status: SavedPlaceStatus;
  source: string | null;
  rating: number | null;
  /** #113 · "Do it again?" on a been save — null = not said. */
  again: boolean | null;
  /** A seed trip's local id ("trip_coast") for a been save. */
  trip: string | null;
  note: string | null;
  suggestedPlace: SuggestedPlace | null;
  /** ISO — created_at. Sets the newest-first order inside a destination. */
  createdAt: string;
}

export function seedDestinations(): SeedDestination[] {
  const d = (key: string, name: string, region: string, lat: number, lng: number): SeedDestination => ({
    key,
    googlePlaceId: `seed_loc_${key}`,
    name,
    region,
    lat,
    lng,
  });
  return [
    d("warrenton", "Warrenton, OR", "Oregon", 46.1651, -123.9238),
    d("nehalem", "Nehalem, OR", "Oregon", 45.7201, -123.8943),
    d("tillamook", "Tillamook, OR", "Oregon", 45.4562, -123.844),
    d("newport", "Newport, OR", "Oregon", 44.6368, -124.0535),
    d("bandon", "Bandon, OR", "Oregon", 43.119, -124.4084),
    d("bend", "Bend, OR", "Oregon", 44.0582, -121.3153),
    d("sanjose", "San José, Costa Rica", "Costa Rica", 9.9281, -84.0907),
    d("westyellowstone", "West Yellowstone, MT", "Montana", 44.6621, -111.1041),
  ];
}

const base = {
  anchor: "pin" as SaveAnchor,
  areaLabel: null,
  region: null,
  type: "campground" as ReservationType,
  status: "want" as SavedPlaceStatus,
  source: null,
  rating: null,
  again: null,
  trip: null,
  note: null,
  suggestedPlace: null,
};

export function seedSaves(): SeedSave[] {
  return [
    // ── Want to go · Oregon 8 ──────────────────────────────────────────────
    {
      ...base,
      name: "Fort Stevens State Park",
      destination: "warrenton",
      region: "Warrenton, OR",
      lat: 46.2045,
      lng: -123.9626,
      source: "Jane & Rick",
      note: "Loop D backs onto the dunes. Walk to the Peter Iredale wreck at low tide.",
      createdAt: "2026-06-12T18:00:00Z",
    },
    {
      ...base,
      name: "Nehalem Bay State Park",
      destination: "nehalem",
      region: "Nehalem, OR",
      lat: 45.6967,
      lng: -123.9335,
      source: "Jane & Rick",
      createdAt: "2026-06-12T18:01:00Z",
    },
    {
      ...base,
      name: "Beverly Beach State Park",
      destination: "newport",
      region: "Newport, OR",
      lat: 44.7262,
      lng: -124.0578,
      source: "Jane & Rick",
      createdAt: "2026-06-12T18:02:00Z",
    },
    {
      ...base,
      name: "Cape Lookout State Park",
      destination: "tillamook",
      region: "Tillamook, OR",
      lat: 45.3637,
      lng: -123.9728,
      source: "Marcy",
      createdAt: "2026-07-04T16:00:00Z",
    },
    {
      ...base,
      name: "great BLM camp spot",
      destination: "bandon",
      lat: 43.05,
      lng: -124.33,
      createdAt: "2026-09-26T00:14:00Z",
    },
    {
      // The offline note (Q3 A): typed with no signal, offered El Chandelier
      // once it synced. The drawn "Did you mean El Chandelier?" strip.
      ...base,
      name: "chandel",
      destination: "bandon",
      anchor: "area",
      areaLabel: "Bandon, OR",
      lat: 43.0512,
      lng: -124.329,
      type: "other",
      suggestedPlace: {
        name: "El Chandelier",
        googlePlaceId: "seed_place_el_chandelier_coos_bay",
        lat: 43.3665,
        lng: -124.2179,
        subline: "Restaurant · Coos Bay, OR",
      },
      createdAt: "2026-09-26T00:12:00Z",
    },
    {
      ...base,
      name: "taco truck Dana said",
      destination: "bend",
      anchor: "area",
      areaLabel: "Bend, OR",
      lat: 44.0569,
      lng: -121.3108,
      type: "other",
      createdAt: "2026-08-20T19:30:00Z",
    },
    {
      ...base,
      name: "Sunny's Smokehouse",
      destination: "bend",
      region: "Bend, OR",
      lat: 44.0582,
      lng: -121.3153,
      type: "dining",
      source: "Forum tip",
      note: "Brisket sells out by 2pm. Big lot, easy pull-through parking for the rig.",
      createdAt: "2026-05-02T15:00:00Z",
    },
    // ── Want to go · Costa Rica 1 ──────────────────────────────────────────
    {
      ...base,
      name: "El Chandelier",
      destination: "sanjose",
      region: "San José, Costa Rica",
      lat: 9.9325,
      lng: -84.0521,
      type: "dining",
      source: "Marcy",
      createdAt: "2026-09-10T01:00:00Z",
    },
    // ── Want to go · Unanchored 2 ──────────────────────────────────────────
    {
      ...base,
      name: "Kalaloch Campground",
      destination: null,
      region: "Olympic NP, WA",
      lat: 47.6118,
      lng: -124.3762,
      source: "Jane & Rick",
      note: "Bluff sites right over the beach — they said book site A15 for the sunset.",
      createdAt: "2026-06-12T17:59:00Z",
    },
    {
      ...base,
      name: "pin in the Alvord Desert",
      destination: null,
      lat: 42.53,
      lng: -118.53,
      type: "other",
      createdAt: "2026-08-30T02:00:00Z",
    },
    // ── Been there 4 ───────────────────────────────────────────────────────
    {
      ...base,
      name: "South Beach State Park",
      destination: "newport",
      region: "Newport, OR",
      lat: 44.6094,
      lng: -124.0631,
      status: "been",
      rating: 5,
      // #113 · the walk's "Last time here" card draws its Again badge.
      again: true,
      trip: "trip_coast",
      note: "Yurts are the move — book early next time. Sunset walks were the whole trip.",
      createdAt: "2025-05-26T20:00:00Z",
    },
    {
      ...base,
      name: "Local Ocean Seafoods",
      destination: "newport",
      region: "Newport, OR",
      lat: 44.6297,
      lng: -124.0526,
      type: "dining",
      status: "been",
      rating: 5,
      again: true,
      trip: "trip_coast",
      note: "Bayfront, watch the boats. Go before 6 or wait an hour.",
      createdAt: "2025-05-25T02:00:00Z",
    },
    {
      // No town within 25 mi of Fishing Bridge: Unanchored.
      ...base,
      name: "Fishing Bridge RV Park",
      destination: null,
      region: "Yellowstone NP, WY",
      lat: 44.5647,
      lng: -110.3735,
      status: "been",
      rating: 4,
      trip: "trip_ystone",
      note: "Only full-hookup in-park. Worth the early reservation; tight but level.",
      createdAt: "2024-09-14T18:00:00Z",
    },
    {
      ...base,
      name: "Old Faithful Loop",
      destination: "westyellowstone",
      region: "Yellowstone NP, WY",
      lat: 44.4605,
      lng: -110.8281,
      type: "activity",
      status: "been",
      rating: 4,
      trip: "trip_ystone",
      note: "Beat the crowd — first eruption after opening. Biscuit Basin boardwalk was quieter.",
      createdAt: "2024-09-12T15:00:00Z",
    },
  ];
}
