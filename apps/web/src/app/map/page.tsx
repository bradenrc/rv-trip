import { Map as MapIcon } from "lucide-react";
import { StubPage } from "@/components/nav/StubPage";

export default function MapPage() {
  return (
    <StubPage
      kicker="Overview"
      title="Map"
      blurb="Everywhere you've been and everywhere you've saved, on one map — visited stops, favorites, and routes across all your trips."
      Icon={MapIcon}
    />
  );
}
