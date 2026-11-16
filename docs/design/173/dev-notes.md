# #173 · dev notes — item i1 of 5 (Core: activeTrip + isoDateInZone)

Scope: plan item **i1** only (#172 · Q4 A). Items i2–i5 are separate dispatches.

## What changed

- `packages/core/src/planner/journal.ts:319-338` — `activeTrip<T extends Pick<Trip, "id" | "startDate" | "endDate">>(trips, today): T | null`,
  placed after `todaysDestination`. This is the wireframe's code, copied as written: dates only (it never reads `status`/`statusAuto`), inclusive at both
  ends, an undated trip is skipped (`!startDate || !endDate`, a guard only, since the DB columns are NOT NULL), the later `startDate` wins, and an
  equal start keeps the first trip in input order (strict `>`).
- `packages/core/src/planner/journal.ts:349-366` — `isoDateInZone(now, timeZone): IsoDate | null`, placed after `localIsoDate`. It uses
  `Intl.DateTimeFormat("en-CA", { timeZone, year/month/day: "numeric"/"2-digit" })`. The `RangeError` from an invalid zone is caught and returns `null`.
- Exports: both functions reach `@rv-trip/core` with no index edit. `packages/core/src/index.ts:3` does `export * from "./planner/index"`, and
  `planner/index.ts:62` does `export * from "./journal"`.
- `apps/mobile/src/store.ts:118-120` — `inProgress` now calls `activeTrip([t], today) !== null` in place of its own inline date comparison. Its `Pick`
  gains `"id"` to fit activeTrip's constraint (every call site passes `b.trip`, a full `Trip`). The import is at `store.ts:26`. Behavior is unchanged
  for dated trips.

## Tests

`packages/core/src/planner/journal.test.ts:236-300` covers:
- **activeTrip**, using the wireframe's seeded table (Loop AUG 01–28 · Crater Lake AUG 21–23 · Bellingham NOV 11–15):
  - no trips returns null
  - one covering trip is returned
  - overlapping trips return the later start, in either input order
  - an equal start keeps the first in input order
  - an undated trip returns null
  - the first day and the last day both count
  - the day before and the day after (JUL 31, AUG 29, NOV 16) return null
  - a `status: "complete", statusAuto: false` trip covering today is still returned
- **isoDateInZone** at `2026-11-16T01:00Z`:
  - America/Boise gives `2026-11-15`
  - UTC gives `2026-11-16`
  - `"Not/AZone"` gives `null`

## For qa

- `isoDateInZone` depends on the runtime's ICU. Node in this worktree resolves America/Boise correctly. The wireframe's FLAG about Vercel's Node ICU is
  for the walk (i3), not this item.
- No UI, API, schema or migration changes in this item.

---

# #173 · dev notes — item i2 of 5 (Phone shell: Trips · Places · + · You)

Scope: plan item **i2** only (#171 · Q5 A · Q6 A). The Map tab is not added here (that is TL4, #186).

## What changed

- `apps/mobile/app/(tabs)/_layout.tsx:41-80`: the screen order is now `(trips)` · `saves` · `add` · `you`.
  - `saves` keeps its file name and route. Its title is now "Places" (`:50`), and it keeps the queue badge.
  - `add`'s title is now "Capture" (`:59`). The tabPress intercept to `/capture` and its accessibility label are unchanged.
  - `you` is new (`:75-79`). Its title is "You" and its glyph is ◉.
  - I updated the doc comment to match.
- `apps/mobile/app/(tabs)/you.tsx` (new file):
  - `YouTab` (`:20-29`) draws the in-screen nav block "You". It is the same styles as saves.tsx's `nav` and `title`, with no kicker (styles at `:209-219`).
  - Under the nav block it renders `RigBody` (`:33`), which is rig.tsx's old `RigScreen` body, unchanged: AccountCard, HomeBaseRow, then the rig card or the "No rig yet" branch.
  - The only other changes are the imports (`../src` became `../../src`, and `SafeAreaView` is added).
- `apps/mobile/app/rig.tsx`: now only `<Redirect href="/you" />`.
- `apps/mobile/app/_layout.tsx`: removed the root `<Stack.Screen name="rig">` (it was at `:39`) and updated the Shell comment.
- `apps/mobile/app/(tabs)/(trips)/index.tsx`: removed the Rig `headerRight` `<Stack.Screen>` (it was at `:36-44`) and dropped the now-unused `Link` and `Stack` imports.
- Copy changes:
  - `apps/mobile/app/(tabs)/saves.tsx:54`: the title is "Places".
  - `apps/mobile/src/itinerary.tsx:411`: "…pull one in from your Places."
  - `packages/core/src/capture/sheet.ts:292`: `OFFLINE_NOTICE.title` is "Offline. Saved places wait on this phone."
- Comments and docs only: `src/ui.tsx:194` and `src/store.ts:63` now say "Places tab". In `apps/mobile/README.md`, the tabs line, the saves/you entries and the Account-card paragraph now point at `(tabs)/you.tsx`.

## Tests

- `packages/core/src/mobile-capture.test.ts`:
  - `:44` checks the tab order Trips · Places · Capture · You by route position and by each screen's own title. It also checks that no "Saves" title is left and that there is no `map` tab.
  - `:60` checks that the + accessibility label is unchanged and that You uses the ◉ glyph.
  - `:69` checks that the badge sits inside the Places (`saves`) screen block and appears exactly once.
  - `:162` has the renames block: the saves.tsx title, the itinerary copy, and a sweep over every `.ts/.tsx` under `apps/mobile/{app,src}`. The sweep strips comments and then asserts there is no `\bSaves\b`. Identifiers such as `useSaves` and `NearbySaves` have no word boundary before "Saves", so they don't match.
- `packages/core/src/mobile-auth.test.ts`:
  - It now reads `app/(tabs)/you.tsx`.
  - `:241` covers the nav title "You" with no kicker, and the Account card (plus Home base) above "No rig yet" in the no-rig branch. The existing checks still run against you.tsx: Account above "Routing input", Sign out and the dev-user stub, the display name, the hook-order branch, and the untouched rig rows.
  - `:175`: the root layout no longer registers `rig`.
  - `:286`: `app/rig.tsx` is a `Redirect` to `/you`, and the Trips list has no `href="/rig"`.
  - The `@clerk/expo` import sweep now checks you.tsx in place of rig.tsx.
- `packages/core/src/capture/sheet.test.ts:145`: expects the new offline title.

## For qa / the walk

- **Render-required:**
  - the four-tab bar on a device,
  - You's SafeAreaView top inset and the nav block,
  - `/rig` redirecting into the You tab (a deep link to `/rig` should land on the tab),
  - the Trips header with no Rig link.
- `typedRoutes` is on (`app.json:59`). `/you` typechecked clean here, but a stale `.expo/types` on the walk machine regenerates on `expo start`.
- I did not run the new tests against the old code first, so I have no red-run evidence. They do assert strings ("Places", "Capture", `name="you"`, the Redirect) that did not exist before this change.

---

# #173 · dev notes — item i3 of 5 (Web shell: Trips · Places · Map, + Capture, avatar → /you, the phone-width five)

Scope: plan item **i3** only (#171 · Q1 C · Q2 B). The /trips list page, the `/` redirect and the `tz` cookie are i4.

## What changed

- `apps/web/src/components/nav/Nav.tsx`
  - `:30-34` `LINKS` (the desktop row) is now Trips (`/trips`, lit on `startsWith("/trips")`) · Places (`/places`) · Map (`/map`). Rig and Settings are gone. The `Caravan` and `Settings` lucide imports are dropped, and `PlusCircle` and `CircleUser` are added.
  - `:40-47` `TABS` is a new list for the bottom bar: Trips · Places · Capture (`/places`, `PlusCircle`, `match: () => false`, `action: true`) · Map · You (`/you`, `CircleUser`, lit on `/you`, `/rig` and `/settings`).
  - `:121` the bottom bar maps `TABS`, with `key={label}` because two entries share `/places`. `:136` the icon is green when `action || active`, so Capture is always green.
  - `:90` the right cluster (theme toggle · + Capture · `<Account/>`) is wrapped in a single `hidden items-center gap-2.5 md:inline-flex` div. Below md the masthead is the mark alone. The toggle button's own markup is byte-for-byte unchanged.
  - `:107-109` + Capture is a `<Link href="/places">`: `rounded-rv-md bg-rv-green px-[13px] py-[7px] text-[13.5px] font-bold text-rv-navy`. Padding and size come from the wireframe's `.btn-cta`.
- `apps/web/src/components/nav/Account.tsx`
  - Clerk's `UserButton` is gone.
  - `:45` signed in: `YouAvatar` is a `<Link href="/you">` wearing the 30px initial avatar (`border-2 border-rv-border-hi bg-rv-green text-rv-navy`). The initial comes from `useUser()`: first name, then username, then email (`initialOf`, `:39`).
  - `:60` keyless: the shipped dashed `DevAccount` pill. The outer `<span>` became the `<Link href="/you">`, and it keeps the same classes, title and children.
  - Signed out: `SignInButton` is unchanged.
- `apps/web/src/app/you/page.tsx` (new, server, `force-dynamic`, `PageShell`)
  - It reads `getPrefsByOwner(owner)`, `getHouseholdOverview(owner)` and `getActor()`.
  - The h1 is `describePeople([actor, ...members])[actor].name`, and falls back to the id, which is "dev-user" keyless.
  - The kicker "You" is in `text-rv-ink-faded`.
  - In the `max-w-[680px]` column:
    - card 1 holds Household → /settings (value `homeBaseRowValue(prefs)`), Rig → /rig and Settings → /settings.
    - card 2 is `<YouAccount clerk={clerkEnabled()} />`.
- `apps/web/src/components/you/rows.tsx` (new, no directive): `YouCard` (Settings' card language, plus an optional `border-dashed`), the `ROW` class string, `Chevron` and `YouLinkRow`.
- `apps/web/src/components/you/YouAccount.tsx` (new, `"use client"`):
  - Clerk: a "Manage account" button (`useClerk().openUserProfile()`) and a "Sign out" button inside `<SignOutButton>`.
  - Keyless: the dashed card, "dev-user" over "Local dev — no Clerk keys, running as the seeded dev-user".
- `apps/web/src/app/places/page.tsx:38`: the kicker is "Your places", and the comment above it is updated.

## Decisions and deviations, for qa to check

1. **+ Capture uses `bg-rv-green`, not the wireframe's `bg-rv-green-cta`** (vet MED). Two existing sweeps in `packages/core/src/theme/nightfall-tokens.test.ts` reject `bg-rv-green-cta` with navy ink:
   - sweep 1 (`:283`) allows `text-rv-navy` only beside `bg-rv-green`/`green-on-dark`.
   - sweep 2 (`:307`) says "no rv-green-cta call site is left carrying CTA duty".

   I first widened sweep 1. Sweep 2 then failed, so I reverted that edit and took the vet's other option. The masthead is a literal `dark` island, where both tokens are `#34d399` (`entry.css:149-150`), so it should be the same pixel. **The walk should confirm the + Capture fill.**
2. **The chevron on the Rig, Settings and Manage account rows is lucide `ChevronRight` (`size-4 text-rv-ink-subtle`), not a "›" text glyph.** The design puts the chevron in rv-ink-subtle, and the sweep at `nightfall-tokens.test.ts:336` allows ink-subtle only on sized icons. On the Household row the "›" comes from `homeBaseRowValue` and is in ink-faded, so no second chevron is drawn (vet MED). The two rows' chevrons therefore differ slightly in shape and shade. That is a walk call.
3. **The h1 is 40px, the shipped Settings and Places h1 size, not the frame's 34px `.ph`.** The /trips frame draws the shipped, unchanged page h1 at 34px too, so I read `.ph` as a stand-in.
4. **`getHouseholdOverview` is read and only feeds the people lookup** (member ids, as settings/page.tsx does). The plan's acceptance names it, but nothing on /you draws a household field directly. The Household row's value is the prefs' home base, per the row table.
5. **Account in Settings' Account card** (`SettingsForm.tsx:131`) is the same `<Account/>`, so on /settings it is now the avatar link to /you, not Clerk's menu. Settings itself is unchanged, and the vetted design does not mention this spot. Walk it.
6. **Trips points at `/trips` before that page exists.** `app/trips/page.tsx` lands in i4. Between this item and i4 the desktop Trips link and the Trips tab 404, and `/` (the old list) no longer lights Trips. The epic ships as one branch with one walk (Q7 A), so this gap never reaches a user.
7. **The trigger for Capture and You is `match: () => false` and an inline `["/you", "/rig", "/settings"].some(…)`**, as the bar spec table says.

## Tests

- `apps/web/src/components/nav/nav.test.ts` (rewritten, source-reading, 21 tests):
  - the desktop labels `[Trips, Places, Map]` with Trips at `/trips` and the `startsWith("/trips")` match.
  - the bottom-bar labels `[Trips, Places, Capture, Map, You]`. Capture goes to /places with PlusCircle, is never lit and is always green. You uses CircleUser and is lit on /you, /rig and /settings.
  - each list is mapped once, and no label is "Rig", "Settings" or "Saves".
  - the toggle → + Capture → Account order inside the `hidden … md:inline-flex` cluster, and the + Capture Link classes.
  - Account.tsx: there is no UserButton, `useUser()` is used, both the signed-in and keyless branches have `<Link href="/you"`, and SignInButton is kept.
  - /you is a server page (no directive in code) that reads `getHouseholdOverview(` and `getPrefsByOwner(`. It checks the `describePeople` fallback, the PageShell, the 680 column, the "You" kicker and the three `YouLinkRow`s, including `value={homeBaseRowValue(prefs)}`. YouAccount must be `"use client"` with `openUserProfile()`, `<SignOutButton>` and the dev-user copy.
  - the places kicker is "Your places".
- `packages/core/src/web-shell.test.ts` is repointed to the new contract (vet MED):
  - `:91-112` LINKS hrefs are `[/trips, /places, /map]` and TABS hrefs are `[/trips, /places, /places, /map, /you]`. /settings and /rig are reached through You. Each list is declared once and mapped once.
  - `:204` the toggle, + Capture and `<Account/>` sit in the `hidden … md:inline-flex` cluster. This replaces the old "no responsive wrapper" test, which Q2 B reverses.
  - The header comment items 1 and 4 are updated.
- Red evidence: nav.test.ts failed first (ENOENT on `app/you/page.tsx`, before the page existed). After the first implementation pass it went to 3 failing / 18 passing. Those three were assertion-shape fixes in the test, not behavior.

## Checks run

- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total` (exit 0). Counts: core `1416 passed`, ui `55 passed`, web `150 passed | 332 skipped`.
- The 332 skipped web tests are the Postgres route-handler integration suite. The log says "API integration tests SKIPPED — no Postgres on …localhost:5433". This item touches no route handler, schema or query, but that suite did not execute here.

## Not done here (operator-owned / flagged)

- **Canvas sync** (wireframe dev note: update `WebTrip.dc.html`'s header to avatar → /you, and add a /you node to `Main.dc.html`'s app map). This is a published canvas artifact outside the repo and outside a dev worktree's contract, so it is **not done**. Whoever owns the canvas should do it per docs/design/README.md's Canvas rule.
- **Render-required at walk** (vet FLAG):
  - `openUserProfile()` opens Clerk's modal.
  - `SignOutButton` signs out.
  - the `useUser()` initial renders and is non-empty once loaded. It renders an empty circle for the instant before `user` loads.
  - below md the masthead is the mark only, and the bottom bar shows five tabs with Capture green.
  - You is lit on /rig and /settings.

---

# #173 · dev notes — item i4 of 5 (Web landing: the list moves to /trips, `/` redirects by the browser's date)

Scope: plan item **i4** only (#172 · Q3 C).

## What changed

- `apps/web/src/app/trips/page.tsx`: this is the old `app/page.tsx`, moved with `git mv` and otherwise unchanged. The trips list now lives at /trips, which fills the gap that i3 note 6 left.
- `apps/web/src/app/page.tsx` (new, server, `force-dynamic`):
  - `:23` reads `listTripsForOwner(owner)` and `cookies()` together, then takes `.get(TZ_COOKIE)`.
  - `:25` computes `isoDateInZone(new Date(), tz)`.
  - `:28` when that is non-null, it calls `redirect(active ? \`/trips/${active.id}\` : "/places")` with `activeTrip(trips, today)`.
  - `:30` otherwise it renders `<LandingStep>` and passes only `{ id, startDate, endDate }` for each trip. There is no PageShell, so the fallback renders nothing visible.
- `apps/web/src/components/nav/LandingStep.tsx` (new, `"use client"`):
  - `:20` writes `tzCookie(<browser zone>)` on mount, inside a try.
  - `:24-25` runs `activeTrip(trips, localIsoDate())`, then `router.replace(...)` to the same target. It returns `null`.
- `apps/web/src/lib/tz.ts` (new):
  - `TZ_COOKIE = "tz"`.
  - `tzCookie(zone)` returns `tz=<zone>; path=/; max-age=31536000; SameSite=Lax`.
  - `readCookie(cookieString, name)`.
- `apps/web/src/components/nav/PrefSync.tsx:31-40`: a new first effect. It writes the cookie when it is missing or differs from `Intl.DateTimeFormat().resolvedOptions().timeZone`, inside a try. The prefs-hydrate effect is unchanged.
- Callers that mean the trips list now go to /trips:
  - `app/trips/new/page.tsx:99` (Cancel).
  - `components/trip/TripPlanner.tsx:1198` (after delete). The comment at `:1192` is updated too.
  - `components/join/JoinAccept.tsx:81` (Not now).
  - These keep `/`, because they are entries: `JoinAccept.tsx:50` (`router.replace("/")` after a join) and the Nav logo.
- Comment-only repoints: `components/dashboard/TripCard.tsx:94` and `components/map/pins.ts:32` now name `app/trips/page.tsx`.
- Repointed tests, all now at `apps/web/src/app/trips/page.tsx`:
  - `packages/core/src/web-shell.test.ts:69`
  - `settings-page.test.ts:185` and `:201`
  - `responsive-sweep.test.ts:22`, `:54` and `:96`

## Decisions, for qa / the walk

1. **The zone is written raw, not URI-encoded.** `/` and `+` are valid cookie-octets, and Next's `cookies()` decode leaves a raw zone name unchanged. `isoDateInZone` is the only validator: a bad value gives `null`, which falls back to the client step.
2. **The redirect is not wrapped in a try.** `redirect()` throws `NEXT_REDIRECT` by design.
3. **The client fallback depends on the trips' dates only.** The status pin is never read, as `activeTrip` already guarantees.
4. **Render-required at walk** (not provable as source):
   - a first visit with no cookie should flash nothing, then land on the active trip or /places.
   - a second visit should redirect on the server, with no client step.
   - a cookie hand-edited to `tz=Not/AZone` should still land, via the client.
   - Vercel's Node ICU must resolve America/* zones. That is the wireframe FLAG carried from i1.
5. **A loop guard is not needed.** Neither target is `/`.

## Tests

- `apps/web/src/lib/tz.test.ts` (3 tests): the cookie name, the exact cookie string, and `readCookie` (hit, only cookie, prefix non-match, empty).
- `apps/web/src/app/landing.test.ts` (11 tests, source-reading like `nav.test.ts`, because there is no request scope or DOM):
  - the list lives at /trips.
  - `/` is a dynamic server page that reads the cookie and calls `isoDateInZone`, then `activeTrip`, then the redirect.
  - `/` hands LandingStep only the id and dates.
  - LandingStep's cookie write, local date and replace.
  - PrefSync's compare-and-write.
  - the three callers push `/trips`, and JoinAccept's replace stays `/`.
- The date logic itself was already covered in core (`journal.test.ts`, i1).
- Red evidence: both new files failed first. tz.test.ts could not load `./tz`, and landing.test.ts failed on reading the not-yet-written `app/page.tsx`, before any implementation existed.

## Checks run

- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`.
  - core: `1416 passed`
  - ui: `55 passed`
  - web: `164 passed | 332 skipped`
- The 332 skipped are the Postgres route-handler suite ("API integration tests SKIPPED — no Postgres on …localhost:5433"). This item touches no handler.
- After a final cosmetic edit to landing.test.ts, I re-ran `npx vitest run src/app/landing.test.ts` (`11 passed`) and `pnpm lint` in apps/web (clean).
- I did not run a browser walk.
