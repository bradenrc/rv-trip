# Design source of truth

The product's screen-flow design lives on the **Travel Log Pivot canvas**
(Claude Design artifact, maintained by Braden + design-Claude):

https://claude.ai/artifact/3jWLLPUQgwcbV8QJeesMRC

It is the foundation design for the travel-log-anchored product (2026-11-15
repositioning) and is KEPT IN SYNC as we build:

- **One dynamic Home** (no Today tab): the app always opens to Home; content
  follows the trip phase — PRE (countdown + get-ready), MID (today's agenda +
  log), POST/none (last recap + Places near you).
- Tab bar: Home · Places · + (capture) · Trips · Agenda.
- Capture is the hero act (place / pin / note, want-or-been with rating inline,
  < 10 seconds). Agenda is supporting. RV corridor routing is future-state —
  navigation is per-hop deep links (Google / Apple / Waze).
- Web = larger-format planning + richer recap (journal + map side-by-side).

Pipeline stage agents: the canvas outranks older stage artifacts under
docs/design/<issue>/ where they conflict; issue specs cite the relevant
artboards by name (e.g. "Main.dc.html — Capture"). When a shipped change
alters a designed screen, the canvas gets updated in the same breath — flag
in dev-notes if it wasn't.
