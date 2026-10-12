import { describe, expect, it } from "vitest";
import {
  API_KEYS_HELP,
  apiKeysCardFrame,
  apiKeyView,
  canMint,
  mcpAddSnippet,
  mintedLabel,
  usedLabel,
} from "./api-keys-view";

/** #162 · Q8 A · docs/design/162 §5 — the pure half of the API keys card. */

const NOW = new Date("2026-10-11T18:00:00Z");
const ROW = {
  id: "k1",
  name: "Claude Code · laptop",
  prefix: "rvk_Q7m2Xa9p",
  lastUsedAt: new Date("2026-10-11T17:58:00Z"),
  revokedAt: null,
};

describe("apiKeyView — what a row says", () => {
  it("is the wireframe's list row", () => {
    expect(apiKeyView(ROW, "Braden", NOW)).toEqual({
      id: "k1",
      name: "Claude Code · laptop",
      prefix: "rvk_Q7m2Xa9p…",
      meta: "rvk_Q7m2Xa9p… · Braden · used 2 min ago",
      revoked: false,
    });
  });

  it("says never used", () => {
    expect(apiKeyView({ ...ROW, lastUsedAt: null }, "Jess", NOW).meta).toBe("rvk_Q7m2Xa9p… · Jess · never used");
  });

  it("reads 'revoked <Mon D>' in UTC on a revoked row", () => {
    const dead = apiKeyView({ ...ROW, revokedAt: new Date("2026-10-11T23:30:00Z") }, "Braden", NOW);
    expect(dead).toMatchObject({ revoked: true, meta: "rvk_Q7m2Xa9p… · Braden · revoked Oct 11" });
  });

  it("never carries anything but finished strings", () => {
    expect(Object.keys(apiKeyView(ROW, "Braden", NOW)).sort()).toEqual(["id", "meta", "name", "prefix", "revoked"]);
  });
});

describe("usedLabel", () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  it("is coarse", () => {
    expect(usedLabel(ago(10_000), NOW)).toBe("used just now");
    expect(usedLabel(ago(2 * 60_000), NOW)).toBe("used 2 min ago");
    expect(usedLabel(ago(3 * 3_600_000), NOW)).toBe("used 3 h ago");
    expect(usedLabel(new Date("2026-10-02T12:00:00Z"), NOW)).toBe("used Oct 2");
    expect(usedLabel(null, NOW)).toBe("never used");
  });
});

describe("apiKeysCardFrame — the frames of §5", () => {
  it("a · empty", () => expect(apiKeysCardFrame({ keyCount: 0, naming: false, minted: false })).toBe("empty"));
  it("b · naming", () => expect(apiKeysCardFrame({ keyCount: 1, naming: true, minted: false })).toBe("naming"));
  it("c · minted wins over everything", () =>
    expect(apiKeysCardFrame({ keyCount: 2, naming: true, minted: true })).toBe("minted"));
  it("d · list", () => expect(apiKeysCardFrame({ keyCount: 2, naming: false, minted: false })).toBe("list"));
});

describe("the copy", () => {
  it("is the wireframe's", () => {
    expect(API_KEYS_HELP).toBe(
      "Let an AI session (Claude Code, the Claude API) read and add to this household's trips. A key acts as the person who minted it, and stops working if they leave the household.",
    );
    expect(mintedLabel("Claude Code · laptop")).toBe("Key minted: Claude Code · laptop");
  });

  it("disables Mint while the name is blank", () => {
    expect(canMint("")).toBe(false);
    expect(canMint("   ")).toBe(false);
    expect(canMint("Claude Code · laptop")).toBe(true);
  });

  it("prints the user-scope claude mcp add line", () => {
    expect(mcpAddSnippet("https://roadvalet.com/api/mcp", "rvk_abc")).toBe(
      'claude mcp add --transport http --scope user tripcaddie https://roadvalet.com/api/mcp \\\n  --header "Authorization: Bearer rvk_abc"',
    );
  });
});
