import { Caravan } from "lucide-react";
import { StubPage } from "@/components/nav/StubPage";

export default function RigPage() {
  return (
    <StubPage
      kicker="Profile"
      title="Your rig"
      blurb="Your RV's dimensions, weight, and hookup needs — used to tailor routing and filter campgrounds that actually fit."
      Icon={Caravan}
    />
  );
}
