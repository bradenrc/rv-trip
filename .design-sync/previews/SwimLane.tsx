import { SwimLane, DestinationBar } from "@rv-trip/ui";

// A chapter's row on the timeline: label gutter + a grid the destinations position into.
export const OregonCoast = () => (
  <SwimLane kicker="Chapter 1" name="Oregon Coast" columns={14}>
    <DestinationBar name="Astoria, OR" range="Aug 2–5" rating={5} resCount={2} ideaCount={0} startCol={2} span={4} />
    <DestinationBar name="Newport, OR" range="Aug 5–9" rating={4} resCount={1} ideaCount={2} startCol={5} span={5} />
  </SwimLane>
);
