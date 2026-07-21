import { CalendarPlus } from "lucide-react";
import { StubPage } from "@/components/nav/StubPage";

export default function NewTripPage() {
  return (
    <StubPage
      kicker="New trip"
      title="Plan a new trip"
      blurb="Trip setup — name it, set your dates and home base, and pick who's along — is coming in a later pass. For now, open one of your existing trips."
      Icon={CalendarPlus}
    />
  );
}
