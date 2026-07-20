import { OpenLane, OpenSpan } from "@rv-trip/ui";

// The unplanned-days lane: label gutter + a grid of open-day spans.
export const Default = () => (
  <OpenLane columns={14}>
    <OpenSpan count={1} startCol={1} span={1} active={false} />
    <OpenSpan count={2} startCol={10} span={2} active={false} />
    <OpenSpan count={3} startCol={12} span={3} active={false} />
  </OpenLane>
);
