import { OpenLane, OpenSpan } from "@rv-trip/ui";

// OpenSpan positions by grid-column, so it's shown inside its OpenLane.
export const Gaps = () => (
  <OpenLane columns={14}>
    <OpenSpan count={2} startCol={10} span={2} active={false} />
    <OpenSpan count={3} startCol={12} span={3} active={false} />
  </OpenLane>
);

export const DropTarget = () => (
  <OpenLane columns={14}>
    <OpenSpan count={5} startCol={9} span={6} active={true} />
  </OpenLane>
);
