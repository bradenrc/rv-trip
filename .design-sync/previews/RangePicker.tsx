import { RangePicker } from "@rv-trip/ui";

const noop = () => {};
const trip = { start: "2026-10-10", end: "2026-10-13" };

/** Whole trip — the default for a single-destination trip (Bellingham, Oct 10 – 13). */
export const WholeTrip = () => (
  <RangePicker value={trip} tripSpan={trip} onChange={noop} onExtendTrip={noop} />
);

/** One day past the trip — Q7 B's amber guard and "Extend trip to Oct 10 – 14". */
export const OutsideTheTrip = () => (
  <RangePicker
    value={{ start: "2026-10-11", end: "2026-10-14" }}
    tripSpan={trip}
    onChange={noop}
    onExtendTrip={noop}
  />
);

/** Trip creation: no tripSpan, so no band and no guard. */
export const NoTripSpan = () => (
  <RangePicker value={{ start: "2026-10-10", end: "2026-10-13" }} onChange={noop} />
);

/** Between the two taps. */
export const Halfway = () => (
  <RangePicker value={{ start: "2026-10-11", end: null }} tripSpan={trip} onChange={noop} />
);
