# The All-Travel Pivot — journey/segment model, capture-first, mobile-first

Converged Braden × design-Claude, 2026-09-25. Supersedes the road-trip-only
framing of the 2026-07-19 MVP spec (the trip grammar itself survives).
Greenfield rules: no users, no history sacred — schema resets are allowed,
speed-to-feel wins.

## The model

- **A trip is the journey; the shape is the detail.** Stops in sequence with
  days — unchanged. The travel MODE lives on the **segment between stops**
  (`travel_segments`: drive / fly / ferry; train later), never on the trip.
  The proof case: Greece — Athens (2d) ✈ Mykonos (4d) ⛴ Naxos ✈ Athens.
  One journey, three modes.
- **Segments are structure; reservations are paperwork.** A fly segment
  BOI→LIR may hold two flight reservations (via LAX). HERE routing + RV
  safety apply to drive segments only. Flight details live on transport
  reservations attached to their segment.
- **Trip-level answers are DEFAULTS, not constraints**: default mode, default
  lodging (hotels / friends / Airbnb / campgrounds), rig on/off. An RV/Drive
  trip never surfaces air detail unless a segment says otherwise. Setup asks
  Braden's questions in his order: how does this trip mostly move → (road)
  lodging defaults + bringing the rig?
- **Full datetimes + IANA timezones on reservations and segments** (decided —
  the dates-only convention is retired). Planning stays day-grained: the
  planner derives days from LOCAL dates.
- **Capture is the product's sticky core** (decided: gets the richest design
  effort). A `Save` has three anchor shapes: Google Place ID (rich) · note +
  city/area · raw pin + note ("great BLM camp spot"). A first-class
  `Destination` (locality by Place ID) anchors saves; opening/creating a trip
  pulls saves within N miles (default radius, adjustable) into its ideas.
  The essence: friends' three loved campgrounds + our favorite from three
  years ago, surfacing when the Oregon coast trip is planned.

## Mobile-first (the ball, called)

From Wave 1 onward, **mobile (Expo, btrip-style) is the definition of done**;
web is the larger-format planning lens. W2's wizard/gantt planning is web-led
by design; capture (W1) and journaling (W3) are phone-primary. W1 includes an
**offline capture queue** — the pin-drop moment happens where there is no
signal. Walk gates include the phone for mobile-primary work.

## Waves (each = one epic)

- **W0 · The Reset** — schema v2 in one clean migration set (old migrations
  discarded): trip defaults, travel_segments, datetimes+tz, saves,
  destinations; segment-aware planner/gantt (modes render distinctly);
  three seed trips — PNW camping loop, Costa Rica Fly & Stay, Greece
  multi-modal — every later design pass is judged against them.
- **W1 · Capture** — mobile-first quick capture (three anchor shapes,
  seconds-fast), offline queue, GoodReads-style shelves evolved from the
  places library, destination auto-anchoring, N-mile trip surfacing.
- **W2 · Setup wizard + per-mode flows** — the setup questions, fly-segment +
  flight add-flows (times/tz UI), lodging flows incl. "friends", lens presets
  per default mode, and the flow/wording pass judged on the three seeds.
- **W3 · Journal** — trip review lens, would-do-again on done things,
  "for next time" resurfacing on return trips via destinations.

## Parked, named

Email-forwarding import (infra + parsing; natural LLM entry) · fuel/cost
estimates + range-between-stations from a rig fuel profile (pairs with the
budget fast-follow; computable per drive segment) · cruises (lodging that
moves) · all-travel naming/branding (roadvalet.com is road-flavored).
