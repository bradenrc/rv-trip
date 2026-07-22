import { SegmentedControl } from "@rv-trip/ui";
import { BookmarkCheck, CircleCheckBig, Route, ChartNoAxesGantt } from "lucide-react";

const noop = () => {};

export const PlacesShelves = () => (
  <SegmentedControl
    value="want"
    onChange={noop}
    options={[
      { value: "want", label: "Want to go", Icon: BookmarkCheck, count: 4 },
      { value: "been", label: "Been there", Icon: CircleCheckBig, count: 4 },
    ]}
  />
);

export const SecondSelected = () => (
  <SegmentedControl
    value="been"
    onChange={noop}
    options={[
      { value: "want", label: "Want to go", Icon: BookmarkCheck, count: 4 },
      { value: "been", label: "Been there", Icon: CircleCheckBig, count: 4 },
    ]}
  />
);

export const WithoutCounts = () => (
  <SegmentedControl
    value="route"
    onChange={noop}
    options={[
      { value: "route", label: "Route", Icon: Route },
      { value: "timeline", label: "Timeline", Icon: ChartNoAxesGantt },
    ]}
  />
);
