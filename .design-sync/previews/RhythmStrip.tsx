import { RhythmStrip } from "@rv-trip/ui";

const DRIVE = "var(--color-rv-navy)";
const STAY = "var(--color-rv-green)";
const OPEN = "var(--color-rv-navy-soft)";

// Aug 1–14: arrive Astoria, stay, drive to Newport, stay, a gap, drive to Bend.
const cells = [
  { color: OPEN, title: "Aug 1 — Open" },
  { color: DRIVE, title: "Aug 2 — Drive → Astoria" },
  { color: STAY, title: "Aug 3 — Stay · Astoria" },
  { color: STAY, title: "Aug 4 — Stay · Astoria" },
  { color: DRIVE, title: "Aug 5 — Drive → Newport" },
  { color: STAY, title: "Aug 6 — Stay · Newport" },
  { color: STAY, title: "Aug 7 — Stay · Newport" },
  { color: STAY, title: "Aug 8 — Stay · Newport" },
  { color: STAY, title: "Aug 9 — Stay · Newport" },
  { color: OPEN, title: "Aug 10 — Open" },
  { color: OPEN, title: "Aug 11 — Open" },
  { color: DRIVE, title: "Aug 12 — Drive → Bend" },
  { color: STAY, title: "Aug 13 — Stay · Bend" },
  { color: STAY, title: "Aug 14 — Stay · Bend" },
];

export const TwoWeeks = () => <RhythmStrip cells={cells} />;
