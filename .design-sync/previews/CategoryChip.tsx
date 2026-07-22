import { CategoryChip } from "@rv-trip/ui";

const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };

export const EveryCategory = () => (
  <div style={row}>
    <CategoryChip type="campground" />
    <CategoryChip type="dining" />
    <CategoryChip type="activity" />
    <CategoryChip type="transport" />
    <CategoryChip type="other" />
  </div>
);

export const Stay = () => <CategoryChip type="lodging" />;
