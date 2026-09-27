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

// Greece, May 10–20 (#110 §1): fly and ferry days carry their glyph on navy.
const greece = [
  { color: STAY, title: "2027-05-10 — Stay · Athens" },
  { color: STAY, title: "2027-05-11 — Stay · Athens" },
  { color: DRIVE, title: "2027-05-12 — Fly → Mykonos", mode: "fly" as const },
  { color: STAY, title: "2027-05-13 — Stay · Mykonos" },
  { color: STAY, title: "2027-05-14 — Stay · Mykonos" },
  { color: STAY, title: "2027-05-15 — Stay · Mykonos" },
  { color: DRIVE, title: "2027-05-16 — Ferry → Naxos", mode: "ferry" as const },
  { color: STAY, title: "2027-05-17 — Stay · Naxos" },
  { color: STAY, title: "2027-05-18 — Stay · Naxos" },
  { color: DRIVE, title: "2027-05-19 — Fly → Athens", mode: "fly" as const },
  { color: STAY, title: "2027-05-20 — Stay · Athens" },
];

export const FlyAndFerry = () => <RhythmStrip cells={greece} />;
