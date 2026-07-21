import { Settings } from "lucide-react";
import { StubPage } from "@/components/nav/StubPage";

export default function SettingsPage() {
  return (
    <StubPage
      kicker="Account"
      title="Settings"
      blurb="Account preferences and defaults. People & groups — who you share trips with — live under Settings › People."
      Icon={Settings}
    />
  );
}
