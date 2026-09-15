#!/usr/bin/env node
/**
 * Fetch the ten brand marks the research pad's doors wear (#82 §5) into
 * `apps/web/public/drill/<id>.png`, from Google's favicon service.
 *
 * BUILD TIME, and the output is COMMITTED — never a runtime hotlink. Two
 * reasons: a walk, CI and an offline laptop must all render the row without
 * reaching the network, and a third-party request from the pad would leak which
 * place a user is reading about to ten hosts.
 *
 * Re-run it to refresh (a brand redraws its mark) and commit what changes. A
 * failure is not fatal to anything: a door whose PNG is missing still renders
 * its 30px chip — the <img>'s alt is the monogram stand-in — and still
 * navigates, which is exactly what the script's own failure path leaves behind.
 *
 *   node scripts/fetch-drill-marks.mjs      (or: pnpm marks:drill)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "apps/web/public/drill");

/**
 * The ten marks, mirroring `DRILL_MARKS` in packages/ui/src/drill.ts. Duplicated
 * rather than imported because this is a plain node script with no bundler and
 * the kit is TypeScript; `drill.test.ts` asserts every door the builder emits
 * has a mark, so a new door that is not listed here is caught by the list that
 * IS the source of truth, not by this copy.
 */
const MARKS = [
  ["google", "google.com"],
  ["reddit", "reddit.com"],
  ["instagram", "instagram.com"],
  ["facebook", "facebook.com"],
  ["thedyrt", "thedyrt.com"],
  ["campendium", "campendium.com"],
  ["youtube", "youtube.com"],
  ["yelp", "yelp.com"],
  ["alltrails", "alltrails.com"],
  ["tripadvisor", "tripadvisor.com"],
];

/** 32px, so the 16px chip stays crisp on a 2x screen. */
const SIZE = 32;

async function main() {
  await mkdir(OUT, { recursive: true });
  let ok = 0;
  for (const [id, domain] of MARKS) {
    const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=${SIZE}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      // The service answers with a generic globe for a domain it does not know;
      // it is a valid PNG, so the only honest check here is that we got one.
      if (bytes.length === 0) throw new Error("empty body");
      await writeFile(join(OUT, `${id}.png`), bytes);
      ok += 1;
      console.log(`  ✓ ${id}.png  ${bytes.length} bytes`);
    } catch (err) {
      console.warn(`  ✗ ${id} — ${String(err)} (the door still renders its monogram)`);
    }
  }
  console.log(`\n${ok}/${MARKS.length} marks written to apps/web/public/drill/`);
}

await main();
