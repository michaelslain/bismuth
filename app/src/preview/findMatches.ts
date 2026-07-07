// app/src/preview/findMatches.ts
// Pure text-find helpers for the PreviewView find bar (Cmd/Ctrl+F over a code/text preview).
// Kept DOM-free so the match/segment/step logic is unit-tested independently of the Solid
// component that renders <mark> spans and scrolls the active match into view.

/** A match range in the source text, half-open `[from, to)`. */
export interface FindMatch {
  from: number;
  to: number;
}

/** A run of the source text: either plain (matchIndex < 0) or the i-th match (matchIndex = i).
 *  Rendered as a text node vs. a `<mark>` by the component. */
export interface FindSegment {
  text: string;
  matchIndex: number;
}

/** All non-overlapping matches of `query` in `text`, left to right. Empty query → `[]`.
 *  Literal (non-regex) substring search; case-insensitive unless `caseSensitive`. `limit`
 *  caps how many matches are returned so a 1-char query in a huge file can't explode the DOM. */
export function findMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  limit = Infinity,
): FindMatch[] {
  const out: FindMatch[] = [];
  if (!query || limit <= 0) return out;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const len = needle.length;
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    out.push({ from: idx, to: idx + len });
    if (out.length >= limit) break;
    idx = hay.indexOf(needle, idx + len); // non-overlapping
  }
  return out;
}

/** Split `text` into alternating plain/match runs given (sorted, non-overlapping) `matches`.
 *  Every character of `text` appears exactly once across the segments, so joining them
 *  reproduces the original — the invariant the highlighted render relies on. */
export function segmentText(text: string, matches: FindMatch[]): FindSegment[] {
  const segs: FindSegment[] = [];
  let pos = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.from > pos) segs.push({ text: text.slice(pos, m.from), matchIndex: -1 });
    segs.push({ text: text.slice(m.from, m.to), matchIndex: i });
    pos = m.to;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), matchIndex: -1 });
  return segs;
}

/** The next active-match index after stepping `dir` (+1 next, -1 prev) with wraparound.
 *  Returns 0 when there are no matches. */
export function stepMatchIndex(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return 0;
  return (((current + dir) % total) + total) % total;
}
