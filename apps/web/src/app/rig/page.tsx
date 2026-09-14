import { getPrefsByOwner, getRigByOwner } from "@rv-trip/db";
import { RigForm } from "@/components/rig/RigForm";
import { getOwner } from "@/lib/owner";
import { unitsFromPrefs } from "@/lib/units";

// Reads the account's rig on every request; don't statically prerender.
export const dynamic = "force-dynamic";

export default async function RigPage() {
  const owner = await getOwner();
  // null on a brand-new account — the form renders with every field blank and
  // no preset selected, which is the same surface, not a separate empty state.
  // `units` decides what the six numbers are TYPED in (feet + inches and pounds,
  // or metres and kilograms). What is stored is metric either way — the form
  // converts on the way in, and metric converts nothing (lib/units.ts).
  const [rig, prefs] = await Promise.all([getRigByOwner(owner), getPrefsByOwner(owner)]);
  return <RigForm rig={rig} units={unitsFromPrefs(prefs)} />;
}
