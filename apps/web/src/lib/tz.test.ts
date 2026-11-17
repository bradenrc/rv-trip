import { describe, expect, it } from "vitest";
import { TZ_COOKIE, readCookie, tzCookie } from "./tz";

/**
 * #173 i4 · #172 · Q3 C — the `tz` cookie that lets `/` answer "today" on the
 * server, in the browser's zone.
 */
describe("the tz cookie", () => {
  it("is named tz", () => {
    expect(TZ_COOKIE).toBe("tz");
  });

  it("is written site-wide for a year, SameSite=Lax", () => {
    expect(tzCookie("America/Boise")).toBe("tz=America/Boise; path=/; max-age=31536000; SameSite=Lax");
  });

  it("reads one cookie back out of document.cookie", () => {
    expect(readCookie("a=1; tz=America/Boise; b=2", "tz")).toBe("America/Boise");
    expect(readCookie("tz=UTC", "tz")).toBe("UTC");
    expect(readCookie("xtz=UTC; a=1", "tz")).toBeNull();
    expect(readCookie("", "tz")).toBeNull();
  });
});
