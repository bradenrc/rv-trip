# #145 · dev notes

Implemented the signed wireframe (`mc/wireframe/issue-145-v0:docs/design/145/index.html`),
with the answers resolved as Q1 = B (script + README line) and Q2 = A (no drift guard).

## What changed

- `apps/mobile/package.json:34`: `"android": "expo start --android"` becomes `"android": "expo run:android"`. `"ios"` (:33) is unchanged.
- `apps/mobile/README.md:51`: one line added to the "Every day" block, directly under the ios line:
  `pnpm --filter @rv-trip/mobile android # expo run:android — the same loop on the Android emulator`.
  As the wireframe says, the `#` follows after a single space and the other lines were not realigned, so the diff stays at +1.

## Out of scope (per the design)

- `docs/superpowers/specs/2026-09-08-native-app-design.md`: not touched (Q1 is B).
- No CI assertion and no mc-dev ask (Q2 is A).

## Tests

This is a config and docs change only. `apps/mobile` has no test script, and the design says
no new tests are needed. No test covers the script value.

## Checks run

- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total` (web: 48 files / 393 tests passed).
- `git grep -n "expo start --android" -- ':!docs/design'`: no hits.
- `git status --short` after the gate: only the two intended files are modified.

## For qa / walk to check

- This is the vet FLAG, still unverified: after the first `pnpm --filter @rv-trip/mobile android` in the walk tree,
  `git status` should be clean, meaning prebuild does not rewrite `package.json`. I did not run `expo run:android` here.
