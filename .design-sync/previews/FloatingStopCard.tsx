import { FloatingStopCard } from "@rv-trip/ui";

export const WithNote = () => (
  <div style={{ maxWidth: 290 }}>
    <FloatingStopCard
      name="Crater Lake NP"
      note="Maybe on the way home if we have time."
      firstIdea="Rim Drive scenic loop"
    />
  </div>
);

export const Minimal = () => (
  <div style={{ maxWidth: 290 }}>
    <FloatingStopCard name="Redwoods" />
  </div>
);
