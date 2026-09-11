# Building with RV Trip Hub components

These are the real, shipped components of the RV Trip Hub trip planner. Compose
them — pass props, nest them — never restyle them; each component styles itself
from the design tokens. No provider or theme wrapper is required: load
`styles.css` (it carries the tokens and the Geist fonts) and components render
correctly on their own.

## Styling idiom — Tailwind utilities + `rv-*` design tokens

For YOUR OWN layout glue around these components (wrappers, spacing, headings),
use Tailwind utilities built on the `rv-*` token scale. Do NOT invent hex colors
or new class names — the palette below is the whole vocabulary.

**Colors** (as `bg-*` / `text-*` / `border-*`):
- Surfaces: `rv-surface` (white cards), `rv-surface-alt` (page bg), `rv-navy` (dark chrome/headers).
- Ink: `rv-ink` (body), `rv-ink-muted` (secondary), `rv-ink-faded` (meta), `rv-ink-subtle` (placeholder only).
- Green (accents/CTAs/"stay", and — since docs/design/43 §4 — *verified*: a claim the
  app has actually checked, such as "Checked against the RV-safe corridor" under a
  Navigate button, or the chosen row in a menu): `rv-green`, `rv-green-cta`
  (text-bearing green), `rv-green-soft` (tint), `rv-green-ink` (text on tint). Green is
  never "success" in the generic sense — only a statement we can prove.
- Borders: `rv-border`, `rv-border-soft` (hairlines), `rv-border-hi`.
- Status: `rv-warning` / `rv-warning-soft` (amber — attention, floating); `rv-info-ink` / `rv-info-soft` (blue — activities).
- Travel: `rv-travel` / `rv-travel-ink` / `rv-travel-soft` (slate-violet). The
  "Travel" category color, and — as a 3px `border-l` only — the structural accent
  that marks a card as being about a *drive* (the restricted drive card in the
  route view). Never a text or fill color outside the category language.

**Radius**: `rounded-rv-sm|md|card|pill`. **Shadow**: `shadow-rv-sm|md|lg|xl`.

**Type**: `font-sans` = Geist (UI text). `font-mono` = Geist Mono — use it for
numbers, dates, times, and mono kickers/labels (that's the product's convention).

## The category language

Reservation/idea types collapse to five categories with fixed icons + colors:
**Stay** (campground/lodging, green), **Eat** (dining, amber), **Do**
(tour/activity/event, blue), **Travel** (transport, slate), **Other**. Use
`<CategoryTile type="campground" />` and `<StatusPill status="planned" />` rather
than hand-building these — they encode the language. Ratings use `<Stars>`;
dateless stops get `<FloatingTag>`.

## Where the truth lives

Read `styles.css` (tokens + `@font-face`) and each component's `.prompt.md`
(props + usage) before composing. All exports live on `window.RvTripUi`.

## Idiomatic snippet

```tsx
import { Stars, ReservationLineItem, FloatingTag } from "@rv-trip/ui";

// A stop's row in a plan — DS components inside your own token-styled layout
<div className="rounded-rv-card border border-rv-border bg-rv-surface p-4 shadow-rv-sm">
  <div className="flex items-center gap-2.5">
    <span className="text-[17px] font-bold text-rv-navy">Astoria, OR</span>
    <span className="font-mono text-[12px] text-rv-ink-faded">Aug 2–5</span>
    <Stars value={5} />
  </div>
  <ReservationLineItem type="campground" name="Astoria/Warrenton KOA" cost={204} />
</div>
```
