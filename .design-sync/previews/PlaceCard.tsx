import { PlaceCard } from "@rv-trip/ui";

const noop = () => {};

const base = {
  ownerId: "u1",
  region: null,
  note: null,
  source: null,
  rating: null,
  tripId: null,
  tripName: null,
};

export const WantToGo = () => (
  <div style={{ maxWidth: 380 }}>
    <PlaceCard
      savedPlace={{
        ...base,
        id: "p1",
        place: { name: "Kalaloch Campground", lat: 47.6118, lng: -124.3762, googlePlaceId: null },
        region: "Olympic NP, WA",
        type: "campground",
        status: "want",
        source: "Jane & Rick",
        note: "Bluff sites right over the beach — they said book site A15 for the sunset.",
      }}
      onAddToTrip={noop}
    />
  </div>
);

export const BeenThere = () => (
  <div style={{ maxWidth: 380 }}>
    <PlaceCard
      savedPlace={{
        ...base,
        id: "p2",
        place: { name: "South Beach State Park", lat: 44.6094, lng: -124.0631, googlePlaceId: null },
        region: "Newport, OR",
        type: "campground",
        status: "been",
        rating: 5,
        tripId: "t1",
        tripName: "Oregon Coast Weekend",
        note: "Yurts are the move — book early next time. Sunset walks were the whole trip.",
      }}
      onRevisit={noop}
    />
  </div>
);

export const Dining = () => (
  <div style={{ maxWidth: 380 }}>
    <PlaceCard
      savedPlace={{
        ...base,
        id: "p3",
        place: { name: "Local Ocean Seafoods", lat: 44.6297, lng: -124.0526, googlePlaceId: null },
        region: "Newport, OR",
        type: "dining",
        status: "been",
        rating: 5,
        tripId: "t1",
        tripName: "Oregon Coast Weekend",
        note: "Bayfront, watch the boats. Go before 6 or wait an hour.",
      }}
      onRevisit={noop}
    />
  </div>
);

export const Travel = () => (
  <div style={{ maxWidth: 380 }}>
    <PlaceCard
      savedPlace={{
        ...base,
        id: "p4",
        place: { name: "Flying J — Ontario", lat: 44.0266, lng: -116.9629, googlePlaceId: null },
        region: "Ontario, OR",
        type: "transport",
        status: "want",
        source: "Range planning",
        note: "Good midpoint fuel + dump on the I-84 run west. Wide lanes.",
      }}
      onAddToTrip={noop}
    />
  </div>
);
