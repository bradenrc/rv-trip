import { getRigByOwner } from "@rv-trip/db";
import { RigForm } from "@/components/rig/RigForm";
import { getOwner } from "@/lib/owner";

// Reads the account's rig on every request; don't statically prerender.
export const dynamic = "force-dynamic";

export default async function RigPage() {
  // null on a brand-new account — the form renders with every field blank and
  // no preset selected, which is the same surface, not a separate empty state.
  const rig = await getRigByOwner(await getOwner());
  return <RigForm rig={rig} />;
}
