import { FilterChip } from "@rv-trip/ui";

const noop = () => {};
const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };

/** The Places library's filter row: "All" active, the four categories inactive. */
export const CategoryRow = () => (
  <div style={row}>
    <FilterChip label="All" count={4} active onClick={noop} />
    <FilterChip label="Stay" count={1} type="campground" active={false} onClick={noop} />
    <FilterChip label="Eat" count={1} type="dining" active={false} onClick={noop} />
    <FilterChip label="Do" count={1} type="activity" active={false} onClick={noop} />
    <FilterChip label="Travel" count={1} type="transport" active={false} onClick={noop} />
  </div>
);

export const CategoryActive = () => (
  <div style={row}>
    <FilterChip label="All" count={4} active={false} onClick={noop} />
    <FilterChip label="Stay" count={1} type="campground" active onClick={noop} />
  </div>
);

export const EmptyCount = () => (
  <FilterChip label="Travel" count={0} type="transport" active={false} onClick={noop} />
);
