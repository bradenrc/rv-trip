import { Users } from "lucide-react";
import { StubPage } from "@/components/nav/StubPage";

export default function PeoplePage() {
  return (
    <StubPage
      kicker="Account"
      title="People & groups"
      blurb="Your roster of travel companions and named groups (e.g. 'spouse', 'fishing buddies'). Trips share to a group; a one-off shares to just the people along for it."
      Icon={Users}
    />
  );
}
