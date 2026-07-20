# Claude Design prompts — RV Trip Hub

Paste these into **claude.ai/design**, one screen at a time. Each prompt is
self-contained: the **Shared context** block below is meant to be prepended to
each screen prompt (or pasted once at the start of a Design session and kept in
context). The goal is on-brand screens built from shadcn/Radix primitives that
drop straight into `apps/web` with minimal rewiring.

When you bring a screen back, hand me the generated code (or the component
files) and I'll wire it to live local data via `@rv-trip/core` + the API.

---

## Shared context (prepend to every screen prompt)

> I'm designing **RV Trip Hub**, a personal trip planner for long RV / road
> trips measured in **weeks, not days** (couple-first; no group features). The
> product's whole identity is a **trip grammar** that stays legible at 4-week
> scale, where day-by-day itinerary apps collapse. Use that grammar's exact
> vocabulary:
>
> - **Trip** → has a title, home base, and a start/end date spanning weeks.
> - **Leg** → a named segment of the journey (e.g. "Oregon Coast"), grouping stops.
> - **Stop** → a place you go (campground, town, park). A stop is either:
>   - **Scheduled** — has arrive/depart dates → appears on the calendar.
>   - **Floating** — ordered but *dateless* → "we'll get there when we get there."
> - **Drive-day vs stay-day** — derived from stop date-spans: the day you arrive
>   somewhere is a **drive-day**; the days you're parked there are **stay-days**;
>   trip days no stop covers are **open** (unplanned gaps worth surfacing).
> - **Reservation** (per stop) — types: campground, lodging, dining, event, tour,
>   activity, transport, other. Has name, dates, confirmation #, cost.
> - **Idea** (per stop) — a backlog item ("Deschutes River float") with status
>   idea / planned / done, promotable into the plan.
> - **Rating + notes** — 1–5 stars and notes on stops, ideas, reservations. This
>   is the "what we loved" memory that seeds return trips.
>
> **Design system constraints (important for handoff):**
> - Build with **shadcn/ui** components (new-york / Radix) and **Tailwind v4**.
> - Use theme tokens, not ad-hoc hex: `bg-background`, `bg-card`, `text-foreground`,
>   `text-muted-foreground`, `border-border`. Neutral base palette + **one** accent.
> - Give the three day-kinds a consistent, distinguishable visual language
>   (drive / stay / open) and reuse it across every screen.
> - **Aesthetic:** warm, outdoorsy-but-clean consumer product — this is a couple
>   planning an adventure, not a dev dashboard. Confident typography, generous
>   spacing, calm color. Light mode as the primary; make it feel like a
>   well-made travel app, not an admin tool.
> - Responsive: great on a planning laptop **and** readable on a phone.
>
> **Example trip to render (use this real data, don't invent generic filler):**
> "Pacific Northwest Loop", home base Boise ID, Aug 1–28 (28 days).
> - Leg **Oregon Coast**: Stop **Astoria, OR** (Aug 2–5, ★★★★★, note "Loved the
>   riverwalk. Book the same RV park next time.", reservations: campground
>   "Astoria/Warrenton KOA" $204, tour "Columbia River Maritime Museum" $38);
>   Stop **Newport, OR** (Aug 5–9, ★★★★, campground "South Beach State Park" $160,
>   ideas: "Oregon Coast Aquarium" (planned), "Rogue Ales brewery lunch" (idea)).
> - Leg **Cascades & Home**: Stop **Bend, OR** (Aug 12–16, idea "Deschutes River
>   float"); Stop **Crater Lake NP** — **FLOATING** (no dates, idea "Rim Drive
>   scenic loop", note "Maybe on the way home if we have time").
> - Note the intentional **open gap** Aug 10–11 (between Newport and Bend) and
>   Aug 17–28 (after Bend) — the calendar should make these visible as unplanned.

---

## Screen 1 — Month-at-a-glance (the signature view)

> Design the **Month-at-a-glance** screen — the signature view and the reason
> this product exists. It's a calendar projection of the whole multi-week trip
> where you instantly read the rhythm of **drive-days, stay-days, and open days**
> across the entire month on one screen.
>
> Requirements:
> - A month/multi-week calendar grid (7 columns) covering the full trip range.
>   Each day cell shows the date and its kind: **drive** (which stop you're
>   arriving at), **stay** (which stop you're parked at), or **open** (unplanned).
> - Stay-day runs at the same stop should read as a continuous block (same stop =
>   same visual band), so a 4-day stay looks like one stay, not four loose cells.
> - Drive-days are visually distinct and show the transition (e.g. "→ Newport").
> - Open/gap days are quietly flagged as needing attention — not alarming, but
>   noticeable ("2 open days").
> - A **"not yet scheduled" rail** listing floating stops (e.g. Crater Lake NP)
>   that can be dragged onto the calendar. Show it as a side rail or a tray.
> - A compact trip header (title, home base, date range, day count) and a
>   **Route ⇄ Calendar** toggle (this is one of two lenses on the same trip).
> - Legend for drive / stay / open.
> - Show light hover affordances on a day (its stop, reservations count).
>
> Make the whole month feel graspable at a glance — that's the entire promise.

---

## Screen 2 — Route / Sequence

> Design the **Route / Sequence** screen — the "lay out the places, take it as
> you go" home. It's the same trip as the calendar, seen as an **ordered
> sequence** of legs → stops, where dates are **optional**.
>
> Requirements:
> - Legs as titled groups, in order; stops within each leg as an ordered,
>   **reorderable** list (drag handles).
> - Each stop row shows: place name; either its date span **or** a clear
>   **"floating"** badge if dateless; its star rating; a one-line note; and
>   compact chips for its reservations (with type + cost) and ideas (with status).
> - Between consecutive **scheduled** stops, show the **drive** between them
>   (e.g. "~2h 15m · 130 mi" — placeholder is fine) as a connector, reinforcing
>   the drive-day/stay-day grammar in sequence form.
> - Adding dates to a floating stop should visibly "promote" it (design the
>   affordance — e.g. a "Schedule" action on the row).
> - Same trip header + **Route ⇄ Calendar** toggle as Screen 1.
> - An "Add stop" and "Add leg" affordance.
>
> This view should feel relaxed and flexible — freedom to plan loosely — while
> still making the structure (legs, order, drives) obvious.

---

## Screen 3 — Stop detail

> Design the **Stop detail** screen/panel for a single stop (use **Astoria, OR**
> from the example). It's where everything about one place lives.
>
> Requirements:
> - Header: place name, date span (or Schedule action if floating), star rating
>   (editable), and a map/place area (a static map placeholder is fine).
> - **Reservations** section: a list supporting all types (campground, lodging,
>   dining, event, tour, activity, transport, other), each with name, dates,
>   confirmation #, cost, rating, notes. Include an "Add reservation" flow
>   (design the form — use a Sheet or Dialog).
> - **Ideas** section: the per-stop backlog with status (idea / planned / done)
>   and a **"promote to reservation"** action (e.g. book the brewery tour).
> - **Notes** area for the stop.
> - A **cost summary** for the stop (sum of reservation costs) — this previews
>   the budget fast-follow.
> - Consider how this appears both as a full page and as a side sheet opened from
>   the other two screens.
>
> Keep it organized and scannable — one place, everything about it, no clutter.

---

## Integration notes (for wiring back into the repo)

When output comes back, favor:
- shadcn component names that already exist in `apps/web/src/components/ui/`
  (card, badge, tabs, dialog, sheet, dropdown-menu, popover, tooltip, input,
  textarea, select, label, separator, scroll-area, skeleton, sonner, button).
- Props/shapes that match `@rv-trip/core` domain types (Trip, Leg, Stop,
  Reservation, Idea) and the `DayCell` from `deriveDays` — so screens bind to
  real local data with a thin mapping, not a rewrite.
- Presentational components that take data as props (no data-fetching inside),
  so the server components in `apps/web` can fetch + pass down.
