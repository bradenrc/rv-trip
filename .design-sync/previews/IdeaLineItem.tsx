import { IdeaLineItem } from "@rv-trip/ui";

export const Planned = () => (
  <div style={{ maxWidth: 420 }}>
    <IdeaLineItem type="activity" title="Oregon Coast Aquarium" status="planned" />
  </div>
);

export const Idea = () => (
  <div style={{ maxWidth: 420 }}>
    <IdeaLineItem type="dining" title="Rogue Ales brewery lunch" status="idea" />
  </div>
);

export const Done = () => (
  <div style={{ maxWidth: 420 }}>
    <IdeaLineItem type="tour" title="Rim Drive scenic loop" status="done" />
  </div>
);
