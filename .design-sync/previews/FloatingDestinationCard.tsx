import { FloatingDestinationCard } from "@rv-trip/ui";

export const WithNote = () => (
  <div style={{ maxWidth: 290 }}>
    <FloatingDestinationCard
      name="Crater Lake NP"
      note="Maybe on the way home if we have time."
      firstIdea="Rim Drive scenic loop"
    />
  </div>
);

export const Minimal = () => (
  <div style={{ maxWidth: 290 }}>
    <FloatingDestinationCard name="Redwoods" />
  </div>
);
