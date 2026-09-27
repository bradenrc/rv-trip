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

// #110 §2: arriveMode. Fly/ferry keep the navy edge and add a glyph before the
// range; null (nothing arrived — no home base) draws no edge.
export const ArrivedBy = () => (
  <SwimLane kicker="Greece" name="Athens & the Cyclades" columns={11}>
    <StopBar name="Athens" range="May 10–12" rating={0} resCount={1} ideaCount={0} startCol={1} span={2} arriveMode={null} />
    <StopBar name="Mykonos" range="May 12–16" rating={0} resCount={1} ideaCount={0} startCol={3} span={4} arriveMode="fly" />
    <StopBar name="Naxos" range="May 16–19" rating={0} resCount={1} ideaCount={0} startCol={7} span={3} arriveMode="ferry" />
  </SwimLane>
);
