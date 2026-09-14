import { getPrefsByOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { PageShell } from "@/components/nav/PageShell";
import { SettingsForm } from "@/components/settings/SettingsForm";

// Reads the account's preference row on every request; don't prerender.
export const dynamic = "force-dynamic";

/**
 * /settings (issue #38) — the account's four preferences, and the door the
 * phone tab bar's fifth tab opens.
 *
 * The same server -> client seam `trips/[id]/page.tsx` uses: the server reads
 * the owner-scoped row and hands it to one "use client" form. The row is what
 * the unresolved first render draws, before `localStorage` is readable.
 */
export default async function SettingsPage() {
  // null on an account that has never chosen anything — every column is
  // nullable on purpose, so the product defaults still win.
  const prefs = await getPrefsByOwner(await getOwner());
  return (
    <PageShell>
      <SettingsForm prefs={prefs} />
    </PageShell>
  );
}
