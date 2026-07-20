import { SwimLane, StopBar } from "@rv-trip/ui";

// StopBar positions itself by grid-column, so it's shown inside its SwimLane.
export const Scheduled = () => (
  <SwimLane kicker="Leg 1" name="Oregon Coast" columns={14}>
    <StopBar name="Astoria, OR" range="Aug 2–5" rating={5} resCount={2} ideaCount={0} startCol={2} span={4} />
    <StopBar name="Newport, OR" range="Aug 5–9" rating={4} resCount={1} ideaCount={2} startCol={5} span={5} />
  </SwimLane>
);

export const Minimal = () => (
  <SwimLane kicker="Leg 2" name="Cascades & Home" columns={14}>
    <StopBar name="Bend, OR" range="Aug 12–16" rating={0} resCount={0} ideaCount={1} startCol={12} span={3} />
  </SwimLane>
);
