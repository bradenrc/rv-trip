import { describe, expect, it } from "vitest";
import {
  BYLINE_CARET,
  HISTORY_TRUNCATED,
  bylineLabel,
  changeFieldLabel,
  changeStamp,
  changeValueLabel,
  changeVerb,
  historyTitle,
} from "./change-byline";
import { ChangeByline } from "./ChangeByline";

/**
 * The byline's copy and its one branch (#78 · docs/design/81 §5).
 *
 * `packages/ui` has no DOM environment — there is no vitest config here at all,
 * so the runner is vitest's `node` default, and no jsdom/happy-dom or
 * @testing-library exists anywhere in the workspace. So everything the line
 * DECIDES lives in `change-byline.ts` and is executed here directly, and the
 * component's "renders nothing" case is proved by CALLING the component
 * function (a component is a plain function; the null return needs no
 * renderer).
 */

describe("changeVerb — the verb comes from last.field", () => {
  it("rating → rated", () => expect(changeVerb("rating")).toBe("rated"));
  it("notes → noted", () => expect(changeVerb("notes")).toBe("noted"));
  it("status → moved", () => expect(changeVerb("status")).toBe("moved"));
});

describe("bylineLabel", () => {
  it("is null when nothing has ever changed here", () => {
    expect(bylineLabel(null)).toBeNull();
  });

  it("is the wireframe's line — 'rated by Jess · Sep 12'", () => {
    expect(
      bylineLabel({ field: "rating", memberName: "Jess", at: "2026-09-12T18:04:11Z" }),
    ).toBe("rated by Jess · Sep 12");
  });

  it("'noted by Braden · Sep 8'", () => {
    expect(
      bylineLabel({ field: "notes", memberName: "Braden", at: "2026-09-08T14:02:00Z" }),
    ).toBe("noted by Braden · Sep 8");
  });

  it("'moved by Jess · Sep 12' — the status verb", () => {
    expect(
      bylineLabel({ field: "status", memberName: "Jess", at: "2026-09-12T18:04:11Z" }),
    ).toBe("moved by Jess · Sep 12");
  });

  it("stamps in UTC, so the server and the browser agree", () => {
    // 23:30 UTC is still "Sep 12" everywhere west of it; a local-time formatter
    // would render Sep 12 on the server and Sep 12/13 in the browser.
    expect(changeStamp("2026-09-12T23:30:00Z")).toBe("Sep 12");
  });
});

describe("ChangeByline", () => {
  it("renders nothing when `last` is null", () => {
    expect(ChangeByline({ last: null })).toBeNull();
  });

  it("renders the closed line in font-mono + text-rv-ink-faded", () => {
    const el = ChangeByline({
      last: { field: "rating", memberName: "Jess", at: "2026-09-12T18:04:11Z" },
    });
    expect(el).not.toBeNull();
    const cls = String((el as { props: { className?: string } }).props.className);
    expect(cls).toContain("font-mono");
    expect(cls).toContain("text-rv-ink-faded");
  });

  it("closed, the whole affordance is the line plus its caret", () => {
    const el = ChangeByline({
      last: { field: "notes", memberName: "Braden", at: "2026-09-08T14:02:00Z" },
    });
    const kids = (el as { props: { children?: unknown } }).props.children;
    expect(JSON.stringify(kids)).toContain("noted by Braden · Sep 8");
    expect(BYLINE_CARET).toBe("▸");
  });
});

describe("the popover's own vocabulary", () => {
  it("labels the field the way the popover draws it — `notes` reads 'note'", () => {
    expect(changeFieldLabel("rating")).toBe("rating");
    expect(changeFieldLabel("notes")).toBe("note");
    expect(changeFieldLabel("status")).toBe("status");
  });

  it("a rating is stars, and an absent value is an em dash", () => {
    expect(changeValueLabel("rating", null)).toBe("—");
    expect(changeValueLabel("rating", "4")).toBe("★★★★");
    expect(changeValueLabel("rating", "5")).toBe("★★★★★");
  });

  it("a note is quoted and cut at a word boundary", () => {
    expect(changeValueLabel("notes", "Nice riverwalk")).toBe("“Nice riverwalk”");
    expect(
      changeValueLabel("notes", "Loved the riverwalk. Book the same RV park next time."),
    ).toBe("“Loved the riverwalk…”");
    expect(
      changeValueLabel("notes", "Riverfront sites 41–48. Ask for one facing the channel."),
    ).toBe("“Riverfront sites 41–48…”");
    expect(changeValueLabel("notes", null)).toBe("—");
  });

  it("a status is its own word", () => {
    expect(changeValueLabel("status", "planned")).toBe("planned");
    expect(changeValueLabel("status", "been")).toBe("been");
  });

  it("names the thing in the header and keeps the truncation line", () => {
    expect(historyTitle("Astoria, OR")).toBe("Change history · Astoria, OR");
    // ASCII apostrophe, verbatim from the wireframe’s §5 spec line and the
    // repo’s own copy ("That didn't save…", PlacesWorkspace.tsx:71).
    expect(HISTORY_TRUNCATED).toBe("older changes aren't kept");
  });
});
