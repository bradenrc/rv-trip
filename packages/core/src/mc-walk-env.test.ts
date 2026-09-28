import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `derive_code_sha` in `scripts/mc-walk-env.sh` (issue #86).
 *
 * mc-dev's walk-staleness belt judges a hand-stood walk env on exactly one key
 * — `sha` in `.mc/walk/<issue>.json`, "what dev built". When the standup's
 * `rev-parse "$branch"` misses, that key used to ship as `""`; the belt reads
 * `""` as absent, falls back to `walked_head` (the as-it-will-land MERGE
 * commit) and respins the operator's stack. The fix is a named ladder plus an
 * honest `null`, and this is its harness.
 *
 * Why here, and why shelling out: `packages/core` is where this repo's pure
 * logic is tested, it has no `vitest.config` so a new `src/*.test.ts` is picked
 * up with no config change, and `node:child_process` needs no new dependency.
 * The shell function is not importable, so the script exposes an un-advertised
 * `__derive-sha <worktree> [regfile] [known]` verb that is exactly this seam —
 * that is the whole reason the derivation became a callable function rather
 * than inline standup steps.
 *
 * Rules held here (all six rows of the design's contract table):
 *
 *   seed     `known` non-empty wins outright; the ladder must not run.
 *   rule 1   a prior entry whose `walked_head` is still this tree's HEAD →
 *            carry its `sha`.
 *   rule 2   HEAD committed by `mc-walk-env@localhost` AND `HEAD^2` exists →
 *            `HEAD^1`. Gated on merge PROVENANCE, never merge shape.
 *   refusal  the same merge SHAPE with a foreign committer falls through to
 *            rule 3 — the ship gate merges main INTO a branch, so a foreign
 *            merge tip's `^1` is the PRE-merge commit and unwrapping it would
 *            read STALE against the fold.
 *   rule 3   otherwise → HEAD (the pre-derivation behaviour).
 *   terminal HEAD unreadable — no repo, or a repo with no commits yet → `none`
 *            with an empty sha; the caller writes `null`.
 *
 * Each case asserts the RULE as well as the sha: landing on the right sha via
 * the wrong rung is the bug wearing a disguise.
 *
 * Rule 2 is only as good as the stamp `refresh_walk_tree` puts on its merge,
 * and a hand-rolled fixture merge cannot prove the real one carries it. So the
 * "producer" block builds its trees through the REAL refresh (the
 * `__refresh-tree <root> <worktree> <branch>` verb) and feeds what it leaves to
 * the ladder — the writer→reader coupling, including under an ambient
 * committer identity that would otherwise outrank the stamp.
 *
 * Hermetic by construction — every fixture is a local `git init` (or a local
 * clone of one) under the OS temp dir. No network, no real registry file, and
 * no `standup`. Every commit pins its own identity (`-c user.email/user.name`):
 * CI checks out with no git identity configured, so a fixture that leaned on an
 * ambient one would red there with "Please tell me who you are".
 *
 * What this cannot assert: that a real `standup` writes a parseable
 * `.mc/walk/<issue>.json`. The heredoc is not reachable without booting a dev
 * server — that stays the walk gate's job.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(REPO, "scripts/mc-walk-env.sh");

/** The identity `refresh_walk_tree` commits its as-it-will-land merge under. */
const SCRIPT_IDENTITY = "mc-walk-env@localhost";
/** Anyone else — a human, or the ship gate. The fixtures' default. */
const HUMAN_IDENTITY = "someone@else.example";
/** The ship gate: it merges main INTO a branch under a normal committer. */
const SHIP_GATE_IDENTITY = "ship-gate@ci.example";

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/**
 * git, with every ambient-environment escape hatch closed: a pinned identity
 * (CI has none), a pinned default branch name (git warns without one), no
 * signing (a global `commit.gpgsign` would abort every fixture commit) and no
 * hooks (the same guard `refresh_walk_tree` uses at :121).
 */
function gitAs(cwd: string, email: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      `user.email=${email}`,
      "-c",
      "user.name=mc-walk-env-test",
      "-c",
      "init.defaultBranch=main",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

const git = (cwd: string, ...args: string[]) => gitAs(cwd, HUMAN_IDENTITY, ...args);

/** An empty throwaway directory, cleaned up after the file. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mc-walk-env-"));
  fixtures.push(dir);
  return dir;
}

/** An empty throwaway git repo. */
function newRepo(): string {
  const dir = tempDir();
  git(dir, "init", "-q");
  return dir;
}

/** Commit one file; returns the new HEAD sha. */
function commit(dir: string, name: string, email = HUMAN_IDENTITY): string {
  writeFileSync(join(dir, name), `${name}\n`);
  gitAs(dir, email, "add", name);
  gitAs(dir, email, "commit", "-q", "-m", name);
  return gitAs(dir, email, "rev-parse", "HEAD");
}

/**
 * A detached tree whose HEAD is a real merge commit — the `checkout --detach
 * <branch>` + `merge <other>` shape `refresh_walk_tree` produces. Deliberately
 * divergent so the merge can never fast-forward.
 *
 * Returns the tree, the merge's sha and its first parent (the code tip rule 2
 * unwraps to).
 */
function mergeTree(mergedBy: string): { dir: string; merge: string; firstParent: string } {
  const dir = newRepo();
  commit(dir, "base");
  git(dir, "branch", "feature");
  commit(dir, "sibling-on-main");
  git(dir, "checkout", "-q", "feature");
  const firstParent = commit(dir, "the-slice");
  git(dir, "checkout", "-q", "--detach", "feature");
  gitAs(dir, mergedBy, "merge", "--no-edit", "-q", "main");
  const merge = git(dir, "rev-parse", "HEAD");
  expect(git(dir, "rev-parse", "HEAD^1"), "fixture must be a real merge").toBe(firstParent);
  expect(git(dir, "log", "-1", "--format=%ce", "HEAD")).toBe(mergedBy);
  return { dir, merge, firstParent };
}

/** Run the ladder. Returns the `<rule>\t<sha>` pair, split. */
function deriveCodeSha(worktree: string, regfile = "", known = ""): [string, string] {
  const out = execFileSync("bash", [SCRIPT, "__derive-sha", worktree, regfile, known], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(out.split("\n").filter(Boolean), "stdout is exactly one line").toHaveLength(1);
  const [rule = "", sha = ""] = out.trim().split("\t");
  return [rule, sha];
}

/** A prior `.mc/walk/<issue>.json`, written somewhere that is not the registry. */
function priorEntry(walkedHead: string, sha: string): string {
  const path = join(tempDir(), "prior.json");
  writeFileSync(path, `${JSON.stringify({ slug: "86", walked_head: walkedHead, sha }, null, 2)}\n`);
  return path;
}

describe("seed — a known sha short-circuits the ladder", () => {
  it("keeps the standup's own rev-parse answer and never reads the tree", () => {
    const dir = newRepo();
    const head = commit(dir, "a");
    const known = "0123456789abcdef0123456789abcdef01234567";

    expect(deriveCodeSha(dir, "", known)).toEqual(["branch", known]);
    // …and the ladder really did not run: HEAD would have answered differently.
    expect(head).not.toBe(known);
  });
});

describe("rule 1 — carry a prior entry the tree has not moved past", () => {
  it("carries entry.sha when walked_head still equals HEAD", () => {
    const dir = newRepo();
    const code = commit(dir, "a");
    const walkedHead = commit(dir, "b");

    // The recorded sha is deliberately NOT the head: carrying it is the only
    // way the right answer can come out.
    expect(deriveCodeSha(dir, priorEntry(walkedHead, code))).toEqual(["carry", code]);
  });

  it("does not carry when the tree has moved on — walked_head no longer matches", () => {
    const dir = newRepo();
    const stale = commit(dir, "a");
    const head = commit(dir, "b");

    expect(deriveCodeSha(dir, priorEntry(stale, stale))).toEqual(["head", head]);
  });

  it("ignores a missing or unreadable regfile instead of dying", () => {
    const dir = newRepo();
    const head = commit(dir, "a");

    const absent = join(tempDir(), "no-such-entry.json");
    expect(deriveCodeSha(dir, absent)).toEqual(["head", head]);

    const corrupt = join(tempDir(), "corrupt.json");
    writeFileSync(corrupt, "{ this is not json");
    expect(deriveCodeSha(dir, corrupt)).toEqual(["head", head]);
  });
});

describe("rule 2 — unwrap a merge the script itself made", () => {
  it("answers HEAD^1 when the committer is mc-walk-env@localhost", () => {
    const { dir, firstParent } = mergeTree(SCRIPT_IDENTITY);

    expect(deriveCodeSha(dir)).toEqual(["unwrap", firstParent]);
  });
});

describe("refusal — provenance, not shape", () => {
  it("falls through to rule 3 on a foreign merge tip, ^1 notwithstanding", () => {
    // The origin/feat/27-migrations shape: the ship gate merges main INTO the
    // branch, so ^1 is the PRE-merge commit. Recording it would read STALE.
    const { dir, merge, firstParent } = mergeTree(HUMAN_IDENTITY);

    expect(deriveCodeSha(dir)).toEqual(["head", merge]);
    expect(merge).not.toBe(firstParent);
  });
});

describe("rule 3 — the tree head is the code commit", () => {
  it("answers HEAD for a plain detached checkout with no record", () => {
    const dir = newRepo();
    const head = commit(dir, "a");
    git(dir, "checkout", "-q", "--detach", "HEAD");

    expect(deriveCodeSha(dir)).toEqual(["head", head]);
  });
});

describe("terminal — an honest null beats a wrong sha", () => {
  it("answers `none` with an empty sha when HEAD cannot be read", () => {
    // Not a git repo at all.
    expect(deriveCodeSha(tempDir())).toEqual(["none", ""]);
  });

  it("answers `none` for a repo with no commits yet — not the literal string HEAD", () => {
    // `git rev-parse HEAD` here PRINTS `HEAD` on stdout before it exits non-zero,
    // so a `|| printf ''` fallback never blanks it: the ladder would answer
    // `head\tHEAD` and the standup would write `"sha": "HEAD"` under a rule-3
    // provenance line (#86 QA, finding CN).
    expect(deriveCodeSha(newRepo())).toEqual(["none", ""]);
  });
});

/**
 * A walk tree the way `standup` stands one: a root cloned from an `origin`, a
 * `feature` branch cut in the root, and a DETACHED worktree of the root at that
 * branch. The refresh then re-points it and merges `origin/main` INTO it.
 *
 *   siblingAfterCut   origin/main moves on after the cut, so the refresh has
 *                     something to merge (a real two-parent merge commit).
 *                     Without it the merge is a no-op and HEAD stays at the
 *                     tip — every standup rv-trip has actually recorded.
 *   foreignMergeTip   the ship gate has already merged main INTO `feature`,
 *                     so the branch tip is itself a merge that is not ours
 *                     (the origin/feat/27-migrations shape).
 */
function walkFixture(opts: { siblingAfterCut: boolean; foreignMergeTip?: boolean }): {
  root: string;
  wt: string;
  tip: string;
} {
  const upstream = newRepo();
  commit(upstream, "base");
  const parent = tempDir();
  git(parent, "clone", "-q", upstream, "root");
  const root = join(parent, "root");
  git(root, "checkout", "-q", "-b", "feature");
  commit(root, "the-slice");
  if (opts.foreignMergeTip) {
    commit(upstream, "sibling-before-ship");
    git(root, "fetch", "-q", "origin", "main");
    gitAs(root, SHIP_GATE_IDENTITY, "merge", "--no-edit", "-q", "origin/main");
    // Throws when there is no second parent: a broken fixture reds as a fixture.
    git(root, "rev-parse", "-q", "--verify", "HEAD^2");
  }
  const tip = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "main");
  git(root, "worktree", "add", "-q", "--detach", join(parent, "wt"), "feature");
  if (opts.siblingAfterCut) commit(upstream, "sibling-after-cut");
  return { root, wt: join(parent, "wt"), tip };
}

/** Run the REAL refresh over a fixture. Returns the four tree facts it records. */
function refreshTree(
  root: string,
  wt: string,
  branch: string,
  env: NodeJS.ProcessEnv = process.env,
): { mergedMain: string; sha: string; walkedHead: string; mergedMainSha: string } {
  const out = execFileSync("bash", [SCRIPT, "__refresh-tree", root, wt, branch], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(out.split("\n").filter(Boolean), "stdout is exactly one line").toHaveLength(1);
  const fields = out.replace(/\n$/, "").split("\t");
  const [mergedMain = "", sha = "", walkedHead = "", mergedMainSha = ""] = fields;
  return { mergedMain, sha, walkedHead, mergedMainSha };
}

describe("producer — the ladder over trees the real refresh built", () => {
  it("unwraps the refresh's own merge to the branch tip, and the stamp is the one rule 2 reads", () => {
    const { root, wt, tip } = walkFixture({ siblingAfterCut: true });

    const facts = refreshTree(root, wt, "feature");
    expect(facts.mergedMain).toBe("true");
    expect(facts.sha).toBe(tip);
    expect(facts.walkedHead, "the refresh made a real merge").not.toBe(tip);
    expect(git(wt, "rev-parse", "HEAD")).toBe(facts.walkedHead);
    expect(git(wt, "rev-parse", "HEAD^1")).toBe(tip);
    expect(git(wt, "log", "-1", "--format=%ce", "HEAD"), "rv-trip's merge identity").toBe(SCRIPT_IDENTITY);

    // No `known`: the seed-miss path, where only the tree can answer.
    expect(deriveCodeSha(wt)).toEqual(["unwrap", tip]);
    // …and the standup's own composition, where the branch rev-parse wins.
    expect(deriveCodeSha(wt, "", facts.sha)).toEqual(["branch", tip]);
  });

  // An ambient identity outranks `-c user.email`: GIT_COMMITTER_EMAIL beats every
  // config level, and `committer.email` beats `user.email` at any level. Either
  // would stamp the refresh's merge as someone else's, rule 2 would refuse it as
  // foreign, and the ladder would record the MERGE head — the #86 misread.
  const committerInEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    GIT_COMMITTER_EMAIL: SHIP_GATE_IDENTITY,
    GIT_COMMITTER_NAME: "ship-gate",
  });
  const committerInConfig = (): NodeJS.ProcessEnv => {
    const config = join(tempDir(), "gitconfig");
    writeFileSync(config, `[committer]\n\temail = ${SHIP_GATE_IDENTITY}\n\tname = ship-gate\n`);
    return { ...process.env, GIT_CONFIG_GLOBAL: config };
  };
  it.each([
    ["GIT_COMMITTER_EMAIL in the environment", committerInEnv],
    ["committer.email in the global git config", committerInConfig],
  ])("keeps its stamp under an ambient identity (%s)", (_shape, ambient) => {
    const { root, wt, tip } = walkFixture({ siblingAfterCut: true });

    const facts = refreshTree(root, wt, "feature", ambient());
    expect(facts.mergedMain).toBe("true");
    expect(git(wt, "log", "-1", "--format=%ce", "HEAD")).toBe(SCRIPT_IDENTITY);
    expect(deriveCodeSha(wt)).toEqual(["unwrap", tip]);
  });

  it("leaves HEAD at the tip when main has nothing new — rule 3 answers the tip", () => {
    // rv-trip's live case: every standup it has recorded merged a main the
    // branch already contained, so the merge moved nothing.
    const { root, wt, tip } = walkFixture({ siblingAfterCut: false });

    const facts = refreshTree(root, wt, "feature");
    expect(facts.mergedMain).toBe("true");
    expect(facts.walkedHead).toBe(tip);
    expect(deriveCodeSha(wt)).toEqual(["head", tip]);
  });

  it("refuses to unwrap a branch whose own tip is the ship gate's merge", () => {
    const { root, wt, tip } = walkFixture({ siblingAfterCut: false, foreignMergeTip: true });

    const facts = refreshTree(root, wt, "feature");
    expect(facts.walkedHead, "nothing new on main — the tree stands at the foreign merge").toBe(tip);
    expect(git(wt, "rev-parse", "HEAD^1")).not.toBe(tip);
    expect(deriveCodeSha(wt)).toEqual(["head", tip]);
  });
});
