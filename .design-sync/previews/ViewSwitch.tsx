import { ViewSwitch } from "@rv-trip/ui";
import { LayoutGrid, Map as MapIcon } from "lucide-react";

const noop = () => {};

const options = [
  { value: "grid", Icon: LayoutGrid, label: "Grid" },
  { value: "map", Icon: MapIcon, label: "Map" },
];

export const GridSelected = () => <ViewSwitch value="grid" onChange={noop} options={options} />;

export const MapSelected = () => <ViewSwitch value="map" onChange={noop} options={options} />;
