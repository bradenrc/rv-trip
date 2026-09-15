import { describe, expect, it } from "vitest";
import { linkLabel, noteLinks } from "./notes";

describe("noteLinks", () => {
  it("finds the link the wireframe's note was pasted with", () => {
    const note =
      "Dyrt reviews say the river-side pull-throughs are the ones — ask for 40s. Pool closes after Labor Day.\nhttps://www.reddit.com/r/GoRVing/comments/astoria_koa/";
    expect(noteLinks(note)).toEqual(["https://www.reddit.com/r/GoRVing/comments/astoria_koa/"]);
  });

  it("keeps first-seen order and drops repeats", () => {
    const note = "https://b.test/2 and https://a.test/1 and https://b.test/2 again";
    expect(noteLinks(note)).toEqual(["https://b.test/2", "https://a.test/1"]);
  });

  it("leaves the sentence's punctuation out of the URL", () => {
    expect(noteLinks("book at https://koa.com/astoria/, then call.")).toEqual([
      "https://koa.com/astoria/",
    ]);
  });

  it("is http(s) only — no bare domains, no other schemes", () => {
    expect(noteLinks("koa.com and mailto:x@y.test and ftp://z.test/a")).toEqual([]);
  });

  it("answers an empty, null or undefined note with nothing", () => {
    expect(noteLinks("")).toEqual([]);
    expect(noteLinks(null)).toEqual([]);
    expect(noteLinks(undefined)).toEqual([]);
  });
});

describe("linkLabel", () => {
  it("reads a subreddit as one word", () => {
    expect(linkLabel("https://www.reddit.com/r/GoRVing/comments/astoria_koa/")).toBe(
      "reddit.com/r/GoRVing",
    );
  });

  it("drops www. and keeps the first path segment", () => {
    expect(linkLabel("https://www.campendium.com/search?search=x")).toBe("campendium.com/search");
    expect(linkLabel("https://koa.com/campgrounds/astoria/")).toBe("koa.com/campgrounds");
  });

  it("names a bare host with no path", () => {
    expect(linkLabel("https://thedyrt.com")).toBe("thedyrt.com");
  });

  it("hands back anything it cannot parse, unchanged", () => {
    expect(linkLabel("https://")).toBe("https://");
  });
});
