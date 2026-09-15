/**
 * What a pasted note contains (#82). The research pad is a place you PASTE
 * into — a Reddit thread, a park's own page — so the links you dropped in come
 * back as chips you can press, instead of raw text you have to re-select.
 *
 * Pure and deliberately narrow: `http(s)://` only, in the order they appear,
 * de-duplicated. No parsing of bare domains, no shortener expansion, no fetch —
 * a chip is the string you typed, nothing about it is looked up.
 */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** Trailing punctuation belongs to the sentence, not to the URL. */
function trimTail(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

export function noteLinks(note: string | null | undefined): string[] {
  if (!note) return [];
  const out: string[] = [];
  for (const match of note.match(URL_RE) ?? []) {
    const url = trimTail(match);
    if (url.length > 8 && !out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * The chip's face: host + the first path segment, `www.` dropped. Enough to
 * recognise ("reddit.com/r/GoRVing") without a 300-character query string
 * wrapping the pad.
 */
export function linkLabel(url: string): string {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = parsed.pathname;
  } catch {
    return url;
  }
  host = host.replace(/^www\./, "");
  const segments = path.split("/").filter(Boolean);
  // r/GoRVing reads as one word; every other first segment stands alone.
  const head = segments[0] === "r" && segments[1] ? `r/${segments[1]}` : segments[0];
  return head ? `${host}/${head}` : host;
}
