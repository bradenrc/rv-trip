import { IdeaCard } from "@rv-trip/ui";

const noop = () => {};

export const AnIdea = () => (
  <div style={{ maxWidth: 460 }}>
    <IdeaCard
      idea={{
        id: "i1",
        stopId: "s1",
        title: "Deschutes River float",
        status: "idea",
        place: null,
        rating: null,
        notes: null,
        sortOrder: 0,
      }}
      noteVisible={false}
      onCycle={noop}
      onRating={noop}
      onNote={noop}
      onCommitNote={noop}
      onToggleNote={noop}
      onPromote={noop}
    />
  </div>
);

export const Done = () => (
  <div style={{ maxWidth: 460 }}>
    <IdeaCard
      idea={{
        id: "i2",
        stopId: "s1",
        title: "Oregon Coast Aquarium",
        status: "done",
        place: null,
        rating: 5,
        notes: "Loved the tide-pool touch tank — go right at opening.",
        sortOrder: 1,
      }}
      noteVisible={true}
      onCycle={noop}
      onRating={noop}
      onNote={noop}
      onCommitNote={noop}
      onToggleNote={noop}
      onPromote={noop}
    />
  </div>
);
