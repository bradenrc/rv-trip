import { PlacesMapPanel } from "@rv-trip/ui";

/** Fills its container — the library's map lens gives it the wide column of a
 * `1fr 360px` split. */
export const MapLens = () => (
  <div style={{ width: 620, height: 420 }}>
    <PlacesMapPanel />
  </div>
);
