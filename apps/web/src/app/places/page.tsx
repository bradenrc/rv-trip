import { Bookmark } from "lucide-react";
import { StubPage } from "@/components/nav/StubPage";

export default function PlacesPage() {
  return (
    <StubPage
      kicker="Library"
      title="Places"
      blurb="Your saved campgrounds, stops, and ideas across every trip — a cross-trip library you can pull from when planning the next one."
      Icon={Bookmark}
    />
  );
}
