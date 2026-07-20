import { SwimLane, StopBar } from "@rv-trip/ui";

// A leg's row on the timeline: label gutter + a grid the stops position into.
export const OregonCoast = () => (
  <SwimLane kicker="Leg 1" name="Oregon Coast" columns={14}>
    <StopBar name="Astoria, OR" range="Aug 2–5" rating={5} resCount={2} ideaCount={0} startCol={2} span={4} />
    <StopBar name="Newport, OR" range="Aug 5–9" rating={4} resCount={1} ideaCount={2} startCol={5} span={5} />
  </SwimLane>
);
