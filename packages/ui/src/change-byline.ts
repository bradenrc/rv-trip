import type { ChangeField, LastChange } from "@rv-trip/core";

/**
 * Everything the byline DECIDES (#78 · docs/design/81 §5), kept apart from the
 * component that draws it.
 *
 * Two reasons, and the second is the load-bearing one:
 *   1. the copy is the design's, so it belongs somewhere a test can read it;
 *   2. `packages/ui` has no DOM environment — no vitest config, no jsdom, no
 *      @testing-library anywhere in the workspace — so a rendered assertion
 *      cannot run here at all. A pure module CAN, and it is where every word,
 *      verb and truncation below is proved.
 */

/** Closed, the line ends in a caret; opened, it turns down (§5's two frames). */
export const BYLINE_CARET = "▸";
export const BYLINE_CARET_OPEN = "▾";

/** The popover shows at most five rows — `HISTORY_LIMIT` in
 * `apps/web/src/app/api/history/route.ts`, mirrored here so the line that says
 * so can be drawn without a second round trip. */
export const HISTORY_ROWS = 5;

/** Drawn under a full list, because the log is not kept forever. */
export const HISTORY_TRUNCATED = "older changes aren't kept";

/**
 * The verb comes from `last.field` and nowhere else — "rated", "noted",
 * "moved". §5's closed status line reads "moved to planned", but `lastChange`
 * carries `{ field, memberName, at }` and no VALUE (the shipped wire contract,
 * packages/core/src/domain/types.ts:70), so the value-bearing half of that
 * phrase is not derivable here; the popover under it is where "→ planned" is
 * actually shown.
 */
const VERBS: Record<ChangeField, string> = {
  rating: "rated",
  notes: "noted",
  status: "moved",
};

export function changeVerb(field: ChangeField): string {
  return VERBS[field];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "Sep 12" — the day an instant landed on, read in UTC.
 *
 * UTC on purpose: `at` is an ISO instant (not one of this grammar's plain
 * `YYYY-MM-DD` trip days), and a local-time formatter would render one day on
 * the server and another in a browser west of the line, which React would then
 * report as a hydration mismatch on a line nobody is looking at.
 */
export function changeStamp(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "rated by Jess · Sep 12" — or null, which is how the byline renders nothing
 * at all on a thing nobody has ever rated or noted. */
export function bylineLabel(last: LastChange | null): string | null {
  if (!last) return null;
  return `${changeVerb(last.field)} by ${last.memberName} · ${changeStamp(last.at)}`;
}

/**
 * The popover's own column reads `note`, singular, even though the wire's
 * vocabulary is `notes` (types.ts:46 — one spelling on the wire so the
 * /places byline can match the set it renders from). This is the one place
 * that difference is visible, and it is a LABEL, not a key.
 */
export function changeFieldLabel(field: ChangeField): string {
  return field === "notes" ? "note" : field;
}

/**
 * A note is long and the row is one line, so it is cut at a word boundary. The
 * width is §5's own two lines — "Loved the riverwalk…" and "Riverfront sites
 * 41–48…", both cut at their first sentence, "Nice riverwalk" left whole.
 */
const NOTE_PREVIEW_MAX = 24;

/** `from`/`to` are text in the log; this is how each field reads back. */
export function changeValueLabel(field: ChangeField, value: string | null): string {
  // NULL is a genuinely absent value — "— → ★★★★" is how the popover tells
  // "was never set" from "cleared".
  if (value === null) return "—";
  if (field === "rating") {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? "★".repeat(n) : value;
  }
  if (field === "notes") return `“${notePreview(value)}”`;
  return value;
}

function notePreview(note: string): string {
  const text = note.trim();
  if (text.length <= NOTE_PREVIEW_MAX) return text;
  const cut = text.slice(0, NOTE_PREVIEW_MAX);
  const boundary = cut.lastIndexOf(" ");
  const head = (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s.,;:!?—–-]+$/u, "");
  return `${head}…`;
}

/** The popover's header names the thing it is about — "Change history ·
 * Astoria, OR". */
export function historyTitle(name: string): string {
  return `Change history · ${name}`;
}
