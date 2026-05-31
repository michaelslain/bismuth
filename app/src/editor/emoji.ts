// app/src/editor/emoji.ts
// Pure, DOM-free helpers for `:emoji:` autocomplete — matcher + ranked search. NO
// CodeMirror imports here, so these run under `bun test` without a browser. Mirrors
// the structure of tag.ts / wikilink.ts. The dataset (emoji + special characters) is
// a generated, committed JSON artifact (see scripts/gen-emoji.ts) — zero runtime dep.
import rawData from "./emoji-data.json";

export type EmojiEntry = { char: string; name: string; keywords: string[] };

export const EMOJI_DATA: EmojiEntry[] = rawData as EmojiEntry[];

// A `:emoji` token is a `:` at start-of-line or after whitespace, followed by ≥1 of
// `[A-Za-z0-9_+-]`, with an optional closing `:`. Requiring whitespace/line-start
// before the `:` excludes `key: value`, `http://x`, and `12:30`; requiring ≥1 query
// char excludes a lone `:` (no popup noise). `$` anchors to the cursor (end of textBefore).
const EMOJI = /(?:^|\s)(:[A-Za-z0-9_+-]+:?)$/;

// Returns line-relative offsets: `from` at the `:` (so accepting replaces the whole
// `:query[:]`), `to` at the cursor, and the bare `query` (no colons).
export function matchEmojiPrefix(
  textBefore: string,
): { from: number; to: number; query: string } | null {
  const m = textBefore.match(EMOJI);
  if (!m) return null;
  const token = m[1]; // ":smile" or ":smile:"
  const from = (m.index ?? 0) + (m[0].length - token.length); // index of the leading ':'
  const hasClosing = token.length > 1 && token.endsWith(":");
  const query = token.slice(1, hasClosing ? -1 : undefined);
  return { from, to: from + token.length, query };
}

// Score an entry against a lowercased query. Lower is better; null means no match.
// Tiers: exact shortcode → shortcode-prefix → exact keyword → shortcode-substring →
// keyword-prefix → keyword-substring. This is why `:happy` and `:joy` both surface 😄
// even though the shortcode is `grinning_face` — keyword matches are first-class.
function score(e: EmojiEntry, q: string): number | null {
  if (e.name === q) return 0;
  if (e.name.startsWith(q)) return 1;
  if (e.keywords.includes(q)) return 2;
  if (e.name.includes(q)) return 3;
  if (e.keywords.some((k) => k.startsWith(q))) return 4;
  if (e.keywords.some((k) => k.includes(q))) return 5;
  return null;
}

// Pure ranked search over an explicit dataset (so tests can use a small fixture).
// Ties break by shorter shortcode then alphabetical; results are deduped by glyph so
// the same character never appears twice (special chars carry alias shortcodes).
export function rankEmoji(entries: EmojiEntry[], query: string, limit = 50): EmojiEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const scored: { e: EmojiEntry; s: number }[] = [];
  for (const e of entries) {
    const s = score(e, q);
    if (s !== null) scored.push({ e, s });
  }
  scored.sort(
    (a, b) => a.s - b.s || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name),
  );
  const out: EmojiEntry[] = [];
  const seen = new Set<string>();
  for (const { e } of scored) {
    if (seen.has(e.char)) continue;
    seen.add(e.char);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// Ranked search over the bundled dataset.
export function searchEmoji(query: string, limit = 50): EmojiEntry[] {
  return rankEmoji(EMOJI_DATA, query, limit);
}
