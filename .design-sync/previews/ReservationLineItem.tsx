import { ReservationLineItem } from "@rv-trip/ui";

export const Campground = () => (
  <div style={{ maxWidth: 420 }}>
    <ReservationLineItem type="campground" name="Astoria/Warrenton KOA" cost={204} />
  </div>
);

export const Tour = () => (
  <div style={{ maxWidth: 420 }}>
    <ReservationLineItem type="tour" name="Columbia River Maritime Museum" cost={38} />
  </div>
);

export const NoCost = () => (
  <div style={{ maxWidth: 420 }}>
    <ReservationLineItem type="dining" name="Rogue Ales brewery lunch" cost={null} />
  </div>
);
