import { ReservationCard } from "@rv-trip/ui";

const noop = () => {};

export const Campground = () => (
  <div style={{ maxWidth: 460 }}>
    <ReservationCard
      reservation={{
        id: "r1",
        stopId: "s1",
        ideaId: null,
        type: "campground",
        name: "Astoria/Warrenton KOA",
        checkIn: "2026-08-02",
        checkOut: "2026-08-05",
        confirmationNumber: "KOA-88213",
        cost: 204,
        rating: 5,
        notes: "Full hookups, site A12 backs to the trees.",
      }}
      dates="Aug 2–5"
      onRating={noop}
      onNote={noop}
      onCommitNote={noop}
    />
  </div>
);

export const Tour = () => (
  <div style={{ maxWidth: 460 }}>
    <ReservationCard
      reservation={{
        id: "r2",
        stopId: "s1",
        ideaId: null,
        type: "tour",
        name: "Columbia River Maritime Museum",
        checkIn: "2026-08-03",
        checkOut: null,
        confirmationNumber: "CRMM-2213",
        cost: 38,
        rating: 0,
        notes: null,
      }}
      dates="Aug 3"
      onRating={noop}
      onNote={noop}
      onCommitNote={noop}
    />
  </div>
);
