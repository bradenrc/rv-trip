import { Ruler } from "@rv-trip/ui";

// Aug 1–14, week markers every 7th column.
const WD = ["S", "S", "M", "T", "W", "T", "F"];
const cells = Array.from({ length: 14 }, (_, i) => {
  const day = i + 1;
  const weekStart = i % 7 === 0;
  return {
    letter: WD[i % 7]!,
    label: weekStart ? `Aug ${day}` : String(day),
    weekStart: weekStart && i > 0,
  };
});

export const TwoWeeks = () => <Ruler cells={cells} />;
