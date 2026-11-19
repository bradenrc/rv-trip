# Design source of truth

The product's screen-flow design lives on the **Travel Log Pivot canvas**
(Claude Design artifact, maintained by Braden + design-Claude):

https://claude.ai/artifact/3jWLLPUQgwcbV8QJeesMRC

It is the foundation design for the travel-log-anchored product (2026-11-15
repositioning) and is KEPT IN SYNC as we build. The canvas was rebuilt on
2026-11-15 against the shipped app (routes, tabs, capture sheet, journal), so
it describes changes to what exists rather than a parallel app.

## What the canvas decides

- **Stable tabs, the same on phone and web**: Trips · Places · + (capture) ·
  Map · You. Shipped today: mobile `Trips · + · Saves`, web
  `Trips · Saves · Map · Rig · Settings`. So: Saves is renamed Places, Map is
  promoted to a mobile tab, Rig and Settings fold under You.
- **A landing rule, not a Home tab.** The tabs never change; what changes is
  which one opens. A trip covering today opens that trip's Journal. Otherwise
  the app opens on Places. Places carries one trip card for a week before a
  trip starts (countdown) and a week after it ends (finish the journal). A
  finished trip is never the default landing.
- **Trip tabs, log first**: Journal · Agenda · Ideas (shipped:
  Itinerary · Ideas · Journal). Agenda is today's Itinerary renamed and keeps
  its Route · Timeline · Map lenses. Journal mid-trip shows up next, today's
  entries and "Log something"; after the trip it is the map plus the list
  grouped by destination.
- **Capture is the existing sheet, tuned**, not a new one. Mid-trip it
  defaults to Been here with stars up front and attaches to the active trip
  even when no destination covers the day. One entry appears in the trip
  Journal and on the Been there shelf. Outside a trip it defaults to Want to
  go.
- **Places**: want to go / been there, near-you first, stay / eat / do
  filters.
- **RV corridor routing steps back**: still wired for rig-on trips, no longer
  featured. Navigate on every hop is a plain deep link to Google, Apple or
  Waze.
- **Web** = the same tabs with more room: journal and map side by side on the
  trip page, places grid with a map panel.

## Status and work

Braden confirmed the renames (Saves → Places, Itinerary → Agenda) and the tab
set on 2026-11-15. The boards are filed as four epics, in order:

- #173 TL1 Shell — tabs, renames, landing rule (`Main.dc.html`)
- #176 TL2 Capture — mid-trip defaults, web capture (`Capture.dc.html`)
- #181 TL3 Trip screen — Journal first, Agenda, Navigate links
  (`Today`, `Recap`, `Agenda`, `WebTrip`)
- #186 TL4 Places and Map — near you first, trip card, Map tab
  (`Places`, `MapTab`, `WebPlaces`)

Added 2026-11-18, in this order:

- #197 Place — one screen per saved place, the same on phone and web: Go
  first (Google · Apple · Waze), then yours, then what others say; edit and
  delete; every row, pin and journal entry opens it (`Place.dc.html`)
- #202 Google map — a second map engine beside Mapbox, switched on the map
  itself and remembered per account; on Google, tap a business to save it.
  Mapbox stays (`MapTab.dc.html`)

## How stage agents use it

The canvas outranks older stage artifacts under docs/design/<issue>/ where
they conflict; issue specs cite the relevant artboards by name (e.g.
"Capture.dc.html — Capture sheet"; "Main.dc.html" is the app map). When a
shipped change alters a designed screen, the canvas gets updated in the same
breath — flag in dev-notes if it wasn't.
