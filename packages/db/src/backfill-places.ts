import "./load-env";
import { LOCATE_MAX_ROWS, locatePlaces } from "@rv-trip/core";
import type { LocateTarget, PlacesProvider } from "@rv-trip/core";
import {
  GooglePlacesProvider,
  googleCredentialsFromEnv,
} from "@rv-trip/core/providers/google-places";
import { dbLocateStore, listLocateTargetsForOwner } from "./locate";

/**
 * `pnpm backfill:places` — the ops escape hatch beside the Locate button
 * (docs/design/41 §6). Same server helper, same owner-scoped store, no page
 * needed.
 *
 * Unbounded by choice, because a human typed it: the 25-row cap bounds a
 * PRESS — a hard ceiling on the Google bill per click — and has nothing to say
 * about an operator who has decided to geocode the whole library. The batching
 * below exists only so a long run prints progress; every coordless row this
 * owner has is walked.
 *
 *   pnpm backfill:places                 # the local dev owner
 *   pnpm backfill:places <ownerId>       # one tenant
 */

const OWNER = "dev-user";

/** The same resolution apps/web/src/lib/places.ts makes, minus the memo. With
 * no key this is StubPlacesProvider, which locates nothing — so the script says
 * so and stops rather than reporting "0 of 42" as if Google had looked. */
function resolveProvider(): PlacesProvider | null {
  const credentials = googleCredentialsFromEnv();
  return credentials ? new GooglePlacesProvider(credentials) : null;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function main() {
  const owner = process.argv[2] ?? OWNER;
  const provider = resolveProvider();
  if (!provider) {
    console.error(
      "GOOGLE_API_KEY is not set, so there is nothing to geocode with — the " +
        "stub provider answers empty and every row would report as still " +
        "unmapped. See .env.example.",
    );
    process.exit(1);
  }

  const targets = await listLocateTargetsForOwner(owner);
  if (targets.length === 0) {
    console.log(`Nothing unmapped for ${owner}.`);
    return;
  }
  console.log(`${targets.length} coordless rows for ${owner}. Locating…`);

  const store = dbLocateStore(owner);
  const stuck: LocateTarget[] = [];
  let located = 0;

  for (const batch of chunk(targets, LOCATE_MAX_ROWS)) {
    const out = await locatePlaces({
      rows: batch.map((t) => ({ kind: t.kind, id: t.id })),
      provider,
      store,
    });
    located += out.located;
    const found = new Set(out.results.map((r) => r.id));
    stuck.push(...batch.filter((t) => !found.has(t.id)));
    console.log(`  … ${located} of ${targets.length}`);
  }

  console.log(`Located ${located} of ${targets.length}.`);
  // Named in full, unlike the toast's "and N more" — an operator wants the list.
  for (const t of stuck) console.log(`  still unmapped · ${t.kind} · ${t.name} (${t.id})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
