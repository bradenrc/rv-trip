import type {
  Idea,
  IdeaCategory,
  IdeaStatus,
  IsoDate,
  Leg,
  Place,
  Reservation,
  Segment,
  Stop,
  Trip,
} from "../domain/types";
import { reconcileSegments, type SegmentIdFactory } from "../domain/segments";

/**
 * The seeded trips as PURE DATA (#110 §7) — domain `Trip`s with local string
 * ids ("stp_conchal", "seg_out"). packages/db/src/seed.ts writes them to the
 * database (mapping each local id to the uuid its insert returns); the core
 * tests assert every one of their days (derive-days.test.ts) and that they
 * carry zero segment/date conflicts (seeds.test.ts). One source, so the seed
 * the walk renders and the seed the tests judge cannot drift.
 *
 * Every trip's segments are built through `reconcileSegments` — the app's own
 * writer — and only then patched with modes and times, so the seed and the app
 * share one writer. Flight numbers are illustrative.
 */

/** The keyless dev tenant the seed writes under (seed.ts). */
export const SEED_OWNER = "dev-household";

const at = (name: string, lat: number, lng: number): Place => ({
  name,
  lat,
  lng,
  googlePlaceId: null,
});

function mkStop(
  s: Pick<Stop, "id" | "legId" | "place" | "sortOrder"> & Partial<Stop>,
): Stop {
  return {
    arriveDate: null,
    departDate: null,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
    lastChange: null,
    ...s,
  };
}

function mkRes(
  r: Pick<Reservation, "id" | "type" | "name"> & Partial<Reservation>,
): Reservation {
  return {
    stopId: null,
    segmentId: null,
    ideaId: null,
    checkIn: null,
    checkOut: null,
    confirmationNumber: null,
    cost: null,
    rating: null,
    notes: null,
    startsAt: null,
    endsAt: null,
    startsTz: null,
    endsTz: null,
    lastChange: null,
    ...r,
  };
}

function mkIdea(
  i: Pick<Idea, "id" | "tripId" | "title" | "sortOrder"> & {
    stopId?: string | null;
    category?: IdeaCategory;
    status?: IdeaStatus;
    place?: Place | null;
    notes?: string | null;
  },
): Idea {
  return {
    stopId: null,
    category: "do",
    status: "idea",
    place: null,
    rating: null,
    notes: null,
    lastChange: null,
    ...i,
  };
}

function mkTrip(
  t: Pick<Trip, "id" | "title" | "startDate" | "endDate" | "legs"> & Partial<Trip>,
): Trip {
  return {
    ownerId: SEED_OWNER,
    homeBase: null,
    homeBasePlace: null,
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    defaultMode: "drive",
    lodgingDefault: null,
    rigOn: true,
    ideas: [],
    segments: [],
    ...t,
  };
}

/** Ids in the order `reconcileSegments` asks for them. */
function named(ids: string[]): SegmentIdFactory {
  let i = 0;
  return () => ids[i++] ?? `seg_extra_${i}`;
}
function numbered(prefix: string): SegmentIdFactory {
  let i = 0;
  return () => `${prefix}_${++i}`;
}

/** Build the dense hop set, then let the caller patch modes and times. */
function withSegments(trip: Trip, ids: SegmentIdFactory, patch: (s: Segment[]) => Segment[] = (s) => s): Trip {
  return { ...trip, segments: patch(reconcileSegments(trip, ids)) };
}

function leg(id: string, tripId: string, title: string, sortOrder: number, stops: Stop[]): Leg {
  return { id, tripId, title, sortOrder, stops };
}

// ── Pacific Northwest Loop — kept exactly as seeded before the reset ───────

export function pnwTrip(): Trip {
  const T = "trip_pnw";
  const astoria = mkStop({
    id: "stp_astoria",
    legId: "leg_coast",
    place: at("Astoria, OR", 46.1879, -123.8313),
    arriveDate: "2026-08-02",
    departDate: "2026-08-05",
    sortOrder: 0,
    rating: 5,
    notes: "Loved the riverwalk. Book the same RV park next time.",
    reservations: [
      mkRes({
        id: "res_koa",
        stopId: "stp_astoria",
        type: "campground",
        name: "Astoria/Warrenton KOA",
        checkIn: "2026-08-02",
        checkOut: "2026-08-05",
        confirmationNumber: "KOA-88213",
        cost: 204,
        rating: 5,
        notes: "Full hookups, site A12 backs to the trees.",
      }),
      mkRes({
        id: "res_maritime",
        stopId: "stp_astoria",
        type: "tour",
        name: "Columbia River Maritime Museum",
        checkIn: "2026-08-03",
        cost: 38,
      }),
    ],
  });
  const newport = mkStop({
    id: "stp_newport",
    legId: "leg_coast",
    place: at("Newport, OR", 44.6365, -124.053),
    arriveDate: "2026-08-05",
    departDate: "2026-08-09",
    sortOrder: 1,
    rating: 4,
    reservations: [
      mkRes({
        id: "res_southbeach",
        stopId: "stp_newport",
        type: "campground",
        name: "South Beach State Park",
        checkIn: "2026-08-05",
        checkOut: "2026-08-09",
        confirmationNumber: "ORP-40192",
        cost: 160,
        rating: 4,
      }),
    ],
    ideas: [
      mkIdea({
        id: "idea_aquarium",
        tripId: T,
        stopId: "stp_newport",
        title: "Oregon Coast Aquarium",
        status: "planned",
        notes: "Half day. Go early to beat crowds.",
        sortOrder: 0,
      }),
      mkIdea({
        id: "idea_rogue",
        tripId: T,
        stopId: "stp_newport",
        title: "Rogue Ales brewery lunch",
        category: "eat",
        sortOrder: 1,
      }),
    ],
  });
  const bend = mkStop({
    id: "stp_bend",
    legId: "leg_mountains",
    place: at("Bend, OR", 44.0582, -121.3153),
    arriveDate: "2026-08-12",
    departDate: "2026-08-16",
    sortOrder: 0,
    ideas: [
      mkIdea({
        id: "idea_deschutes",
        tripId: T,
        stopId: "stp_bend",
        title: "Deschutes River float",
        sortOrder: 0,
      }),
    ],
  });
  const crater = mkStop({
    id: "stp_crater",
    legId: "leg_mountains",
    place: at("Crater Lake NP", 42.9446, -122.109),
    sortOrder: 1,
    notes: "Maybe on the way home if we have time — take it as it comes.",
    ideas: [
      mkIdea({
        id: "idea_rimdrive",
        tripId: T,
        stopId: "stp_crater",
        title: "Rim Drive scenic loop",
        sortOrder: 0,
      }),
    ],
  });
  const trip = mkTrip({
    id: T,
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    // Pinned: the demo trip's dates have passed, and deriveTripStatus would
    // otherwise read it as complete. The whole app is built around it being
    // the trip you are planning, so the seed makes that a manual choice.
    status: "planning",
    statusAuto: false,
    defaultMode: "drive",
    lodgingDefault: "campground",
    rigOn: true,
    legs: [
      leg("leg_coast", T, "Oregon Coast", 0, [astoria, newport]),
      leg("leg_mountains", T, "Cascades & Home", 1, [bend, crater]),
    ],
    // The SHELF (#80): one of each kind.
    ideas: [
      mkIdea({
        id: "idea_kiwanda",
        tripId: T,
        title: "Cape Kiwanda tide pools",
        place: at("Cape Kiwanda State Natural Area", 45.2151, -123.9743),
        sortOrder: 0,
      }),
      mkIdea({
        id: "idea_localocean",
        tripId: T,
        title: "Local Ocean Seafoods",
        category: "eat",
        place: at("Local Ocean Seafoods", 44.6299, -124.0534),
        sortOrder: 1,
      }),
      mkIdea({
        id: "idea_hotsprings",
        tripId: T,
        title: "Hot springs south of Bend",
        category: "stay",
        sortOrder: 2,
      }),
    ],
  });
  // 4 × drive, untimed: home→Astoria · Astoria→Newport · Newport→Bend · Bend→Crater Lake.
  return withSegments(trip, numbered("seg_pnw"));
}

// ── Costa Rica Fly & Stay ──────────────────────────────────────────────────

export function costaRicaTrip(): Trip {
  const T = "trip_cr";
  const conchal = mkStop({
    id: "stp_conchal",
    legId: "leg_guanacaste",
    place: at("Westin Reserva Conchal", 10.4047, -85.8127),
    arriveDate: "2027-01-16",
    departDate: "2027-01-24",
    sortOrder: 0,
    reservations: [
      mkRes({
        id: "res_westin",
        stopId: "stp_conchal",
        type: "lodging",
        name: "Westin Reserva Conchal",
        checkIn: "2027-01-16",
        checkOut: "2027-01-24",
      }),
    ],
    ideas: [
      mkIdea({
        id: "idea_snorkel",
        tripId: T,
        stopId: "stp_conchal",
        title: "Playa Conchal snorkel",
        sortOrder: 0,
      }),
      mkIdea({
        id: "idea_surf",
        tripId: T,
        stopId: "stp_conchal",
        title: "Tamarindo surf lesson",
        sortOrder: 1,
      }),
    ],
  });
  const trip = mkTrip({
    id: T,
    title: "Costa Rica Fly & Stay",
    homeBase: "Boise, ID",
    startDate: "2027-01-16",
    endDate: "2027-01-25",
    defaultMode: "fly",
    lodgingDefault: "hotel",
    rigOn: false,
    legs: [leg("leg_guanacaste", T, "Guanacaste", 0, [conchal])],
  });
  return withSegments(trip, named(["seg_out"]), (segs) => [
    // BOI 06:05 MST → LIR 17:45 CST, two flights, on the segment (Q2 A).
    ...segs.map((s) =>
      s.id === "seg_out"
        ? {
            ...s,
            departAt: "2027-01-16T13:05:00Z",
            departTz: "America/Boise",
            arriveAt: "2027-01-16T23:45:00Z",
            arriveTz: "America/Costa_Rica",
            reservations: [
              mkRes({
                id: "res_aa2451",
                segmentId: "seg_out",
                type: "transport",
                name: "AA 2451 BOI→LAX",
                startsAt: "2027-01-16T13:05:00Z",
                startsTz: "America/Boise",
                endsAt: "2027-01-16T15:10:00Z",
                endsTz: "America/Los_Angeles",
              }),
              mkRes({
                id: "res_aa2208",
                segmentId: "seg_out",
                type: "transport",
                name: "AA 2208 LAX→LIR",
                startsAt: "2027-01-16T17:40:00Z",
                startsTz: "America/Los_Angeles",
                endsAt: "2027-01-16T23:45:00Z",
                endsTz: "America/Costa_Rica",
              }),
            ],
          }
        : s,
    ),
    // The redeye home — LIR Sun 19:30 → BOI Mon 08:50. reconcileSegments never
    // invents a → home row; only the seed writes one in W0.
    {
      id: "seg_home",
      tripId: T,
      fromStopId: "stp_conchal",
      toStopId: null,
      mode: "fly",
      departAt: "2027-01-25T01:30:00Z",
      departTz: "America/Costa_Rica",
      arriveAt: "2027-01-25T15:50:00Z",
      arriveTz: "America/Boise",
      sortOrder: segs.length,
      reservations: [],
    },
  ]);
}

// ── Greece — Athens & the Cyclades ─────────────────────────────────────────

/** A hop timed on one local day in Europe/Athens (EEST, UTC+3 in May). */
function athensHop(date: IsoDate, depart: string, arrive: string) {
  const utc = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return `${date}T${String(h - 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
  };
  return {
    departAt: utc(depart),
    arriveAt: utc(arrive),
    departTz: "Europe/Athens",
    arriveTz: "Europe/Athens",
  };
}

export function greeceTrip(): Trip {
  const T = "trip_gr";
  const hotel = (stopId: string, name: string, checkIn: IsoDate, checkOut: IsoDate) =>
    mkRes({ id: `res_${stopId}`, stopId, type: "lodging", name, checkIn, checkOut });
  const athens1 = mkStop({
    id: "stp_athens1",
    legId: "leg_athens",
    place: at("Athens", 37.9838, 23.7275),
    arriveDate: "2027-05-10",
    departDate: "2027-05-12",
    sortOrder: 0,
    reservations: [hotel("stp_athens1", "Electra Palace Athens", "2027-05-10", "2027-05-12")],
  });
  const mykonos = mkStop({
    id: "stp_mykonos",
    legId: "leg_cyclades",
    place: at("Mykonos", 37.4467, 25.3289),
    arriveDate: "2027-05-12",
    departDate: "2027-05-16",
    sortOrder: 0,
    reservations: [hotel("stp_mykonos", "Mykonos Town hotel", "2027-05-12", "2027-05-16")],
  });
  const naxos = mkStop({
    id: "stp_naxos",
    legId: "leg_cyclades",
    place: at("Naxos", 37.1036, 25.3763),
    arriveDate: "2027-05-16",
    departDate: "2027-05-19",
    sortOrder: 1,
    reservations: [hotel("stp_naxos", "Naxos Chora hotel", "2027-05-16", "2027-05-19")],
  });
  const athens2 = mkStop({
    id: "stp_athens2",
    legId: "leg_back",
    place: at("Athens", 37.9838, 23.7275),
    arriveDate: "2027-05-19",
    departDate: "2027-05-20",
    sortOrder: 0,
    reservations: [hotel("stp_athens2", "Plaka hotel, Athens", "2027-05-19", "2027-05-20")],
  });
  const trip = mkTrip({
    id: T,
    title: "Greece — Athens & the Cyclades",
    homeBase: null,
    startDate: "2027-05-10",
    endDate: "2027-05-20",
    defaultMode: "fly",
    lodgingDefault: "hotel",
    rigOn: false,
    legs: [
      leg("leg_athens", T, "Athens", 0, [athens1]),
      leg("leg_cyclades", T, "Cyclades", 1, [mykonos, naxos]),
      leg("leg_back", T, "Back to Athens", 2, [athens2]),
    ],
  });
  const times: Record<string, Partial<Segment>> = {
    seg_ath_jmk: { mode: "fly", ...athensHop("2027-05-12", "11:05", "11:45") },
    seg_jmk_jnx: { mode: "ferry", ...athensHop("2027-05-16", "10:30", "11:15") },
    seg_jnx_ath: { mode: "fly", ...athensHop("2027-05-19", "13:40", "14:25") },
  };
  return withSegments(trip, named(Object.keys(times)), (segs) =>
    segs.map((s) => ({ ...s, ...times[s.id] })),
  );
}

// ── the secondary trips, across the dashboard's statuses ────────────────────

type SecondaryStop = {
  name: string;
  lat: number;
  lng: number;
  arriveDate: IsoDate | null;
  departDate: IsoDate | null;
};

function secondary(
  id: string,
  t: Pick<Trip, "title" | "startDate" | "endDate" | "status"> & Partial<Trip>,
  legs: { title: string; stops: SecondaryStop[] }[],
): Trip {
  const trip = mkTrip({
    id,
    homeBase: "Boise, ID",
    ...t,
    legs: legs.map((l, li) =>
      leg(
        `${id}_leg${li}`,
        id,
        l.title,
        li,
        l.stops.map((s, si) =>
          mkStop({
            id: `${id}_leg${li}_stp${si}`,
            legId: `${id}_leg${li}`,
            place: at(s.name, s.lat, s.lng),
            arriveDate: s.arriveDate,
            departDate: s.departDate,
            sortOrder: si,
          }),
        ),
      ),
    ),
  });
  return withSegments(trip, numbered(`${id}_seg`));
}

export function desertTrip(): Trip {
  return secondary(
    "trip_desert",
    {
      title: "Desert Southwest Winter",
      startDate: "2026-01-06",
      endDate: "2026-03-30",
      status: "upcoming",
    },
    [
      {
        title: "Utah",
        stops: [
          { name: "Moab, UT", lat: 38.5733, lng: -109.5498, arriveDate: "2026-01-10", departDate: "2026-01-20" },
          { name: "Zion NP", lat: 37.2982, lng: -113.0263, arriveDate: null, departDate: null },
        ],
      },
      {
        title: "Arizona",
        stops: [
          { name: "Sedona, AZ", lat: 34.8697, lng: -111.761, arriveDate: "2026-01-25", departDate: "2026-02-05" },
          { name: "Tucson, AZ", lat: 32.2226, lng: -110.9747, arriveDate: "2026-02-10", departDate: "2026-03-01" },
        ],
      },
    ],
  );
}

export function coastWeekendTrip(): Trip {
  return secondary(
    "trip_coast",
    {
      title: "Oregon Coast Weekend",
      startDate: "2025-05-23",
      endDate: "2025-05-26",
      status: "complete",
      rating: 5,
      note: "South Beach yurts booked early next time — sunset walks were the whole trip.",
    },
    [
      {
        title: "Coast",
        stops: [
          { name: "Newport, OR", lat: 44.6365, lng: -124.053, arriveDate: "2025-05-23", departDate: "2025-05-26" },
        ],
      },
    ],
  );
}

export function yellowstoneTrip(): Trip {
  return secondary(
    "trip_ystone",
    {
      title: "Yellowstone & Tetons",
      startDate: "2024-09-08",
      endDate: "2024-09-19",
      status: "complete",
      rating: 4,
      note: "Fishing Bridge RV park is the only full-hookup in-park — worth the early reservation.",
    },
    [
      {
        title: "Yellowstone",
        stops: [
          { name: "Fishing Bridge, WY", lat: 44.5647, lng: -110.3735, arriveDate: "2024-09-08", departDate: "2024-09-14" },
        ],
      },
      {
        title: "Tetons",
        stops: [
          { name: "Jackson, WY", lat: 43.4799, lng: -110.7624, arriveDate: "2024-09-15", departDate: "2024-09-19" },
        ],
      },
    ],
  );
}

/** Every seeded trip, in the order seed.ts writes them. */
export function seedTrips(): Trip[] {
  return [
    pnwTrip(),
    costaRicaTrip(),
    greeceTrip(),
    desertTrip(),
    coastWeekendTrip(),
    yellowstoneTrip(),
  ];
}
