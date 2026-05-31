// app/src/editor/emoji.ts
// Pure, DOM-free helpers for `:emoji:` autocomplete — matcher + ranked search. NO
// CodeMirror imports here, so these run under `bun test` without a browser. Mirrors
// the structure of tag.ts / wikilink.ts. The dataset (emoji + special characters) is
// a generated, committed JSON artifact (see scripts/gen-emoji.ts) — zero runtime dep.
import rawData from "./emoji-data.json";

export type EmojiEntry = { char: string; name: string; keywords: string[] };

export const EMOJI_DATA: EmojiEntry[] = rawData as EmojiEntry[];

// Curated "most-used" shortcodes (unicode-emoji-json slugs), highest-frequency first.
// Used to (a) fill the popup the instant a lone `:` is typed and (b) bias common emojis
// higher among filtered matches. Every entry is verified to resolve against the dataset.
const POPULAR: string[] = [
  "face_with_tears_of_joy", "red_heart", "smiling_face_with_heart_eyes", "rolling_on_the_floor_laughing",
  "loudly_crying_face", "thumbs_up", "folded_hands", "fire", "smiling_face_with_smiling_eyes",
  "smiling_face_with_hearts", "face_blowing_a_kiss", "beaming_face_with_smiling_eyes", "grinning_face",
  "winking_face", "slightly_smiling_face", "smiling_face_with_sunglasses", "thinking_face", "party_popper",
  "sparkles", "hundred_points", "check_mark_button", "eyes", "rocket", "clapping_hands", "raising_hands",
  "pleading_face", "grinning_face_with_sweat", "smirking_face", "crying_face", "person_shrugging",
  "person_facepalming", "waving_hand", "face_with_rolling_eyes", "star_struck", "flexed_biceps",
  "ok_hand", "victory_hand", "grinning_squinting_face", "thumbs_down", "skull", "sparkling_heart",
];

// shortcode -> popularity rank (0 = most popular).
const POP_RANK = new Map<string, number>(POPULAR.map((name, i) => [name, i]));
const popRank = (name: string): number => POP_RANK.get(name) ?? Number.MAX_SAFE_INTEGER;

// A `:emoji` token is a `:` at start-of-line or after whitespace, then zero-or-more of
// `[A-Za-z0-9_+-]`, with an optional closing `:`. Requiring whitespace/line-start before
// the `:` excludes `key: value`, `http://x`, and `12:30`. A LONE `:` matches (empty query)
// so the popup opens instantly, Notion-style; Escape dismisses it, leaving the colon as
// literal text. `$` anchors to the cursor (end of textBefore).
const EMOJI = /(?:^|\s)(:[A-Za-z0-9_+-]*:?)$/;

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

// --- fuzzy (typo-tolerant) matching on emoji NAME tokens -----------------------
// We want a mistyped emoji NAME to still find the emoji: `rocekt` → rocket, `hart` →
// heart, `smlie` → smile. Fuse's bitap is poor at this on our data (it matched `hart`
// to "chart" and missed transpositions like `rocekt`), so we use Damerau-Levenshtein
// edit distance — which counts a transposition (rocekt↔rocket) as ONE edit — compared
// against each entry's individual NAME tokens (the shortcode split on `_`) plus its
// keyword tokens. Matching per-token, not against the whole descriptive slug, is what
// makes `hart` reach `red_heart` (token "heart") without drowning in long-slug noise.

// Optimal string alignment (Damerau-Levenshtein restricted to adjacent transpositions).
// Early-exits once the running minimum exceeds `max` so most comparisons stop fast.
function editDistance(a: string, b: string, max: number): number {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev2: number[] = [];
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1); // transposition
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already worse than allowed
    prev2 = prev;
    prev = curr;
    curr = new Array(bl + 1);
  }
  return prev[bl];
}

// Allowed edits scale with query length: short queries must match tightly (1 edit),
// longer ones tolerate more. Capped so a 4-char query can't fuzz into anything.
function maxEditsFor(qlen: number): number {
  if (qlen <= 3) return 1;
  if (qlen <= 6) return 2;
  return 3;
}

// The searchable tokens for an entry: the shortcode split on `_`, the whole shortcode,
// and the keywords. Deduped. (e.g. red_heart → ["red","heart","red_heart","love",...].)
function tokensFor(e: EmojiEntry): string[] {
  return [...new Set([...e.name.split("_"), e.name, ...e.keywords])];
}

// Best (smallest) edit distance from the query to any of the entry's tokens, within
// `max`. Returns max+1 ("no fuzzy match") if nothing is close enough. Only tokens of
// comparable length are compared (length filter inside editDistance handles the rest).
function fuzzyDistance(e: EmojiEntry, q: string, max: number): number {
  let best = max + 1;
  for (const t of tokensFor(e)) {
    if (!t) continue;
    const d = editDistance(q, t, Math.min(max, best - 1 < 0 ? 0 : best - 1));
    if (d < best) {
      best = d;
      if (best === 0) break;
    }
  }
  return best;
}

// Keep the first occurrence of each glyph (special chars carry alias shortcodes for one
// character), capped at `limit`.
function dedupeByChar(list: EmojiEntry[], limit: number): EmojiEntry[] {
  const out: EmojiEntry[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (seen.has(e.char)) continue;
    seen.add(e.char);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// Pure ranked search over an explicit dataset (so tests can use a small fixture).
// An EMPTY query (a lone `:`) returns the curated most-used set in popularity order, so
// the popup is useful the instant `:` is typed. For a real query: precise tiered matches
// (exact/prefix/substring on shortcode + keywords) come FIRST; then a typo-tolerant fuzzy
// pass over the emoji name tokens catches misspellings (`:rocekt`→🚀, `:hart`→❤️,
// `:smlie`→🙂). Results are deduped by glyph.
export function rankEmoji(entries: EmojiEntry[], query: string, limit = 50): EmojiEntry[] {
  const q = query.toLowerCase().trim();

  if (!q) {
    const popular = entries
      .filter((e) => POP_RANK.has(e.name))
      .sort((a, b) => popRank(a.name) - popRank(b.name));
    return dedupeByChar(popular, limit);
  }

  // A non-empty query with no letter/digit (`:-`, `:+`, `:_`) is punctuation noise, not an
  // emoji search. `:+1`/`:-1` still pass because they contain a digit.
  if (!/[a-z0-9]/.test(q)) return [];

  // Phase 1 — precise tiered matches.
  const scored: { e: EmojiEntry; s: number }[] = [];
  const exactChars = new Set<string>();
  for (const e of entries) {
    const s = score(e, q);
    if (s !== null) {
      scored.push({ e, s });
      exactChars.add(e.char);
    }
  }
  // score → popularity → shorter shortcode → alphabetical → glyph codepoint. The final
  // key makes the order total, so dual-glyph shortcodes (e.g. :divide = ÷ and ➗) resolve
  // deterministically instead of relying on sort stability + dataset insertion order.
  scored.sort(
    (a, b) =>
      a.s - b.s ||
      popRank(a.e.name) - popRank(b.e.name) ||
      a.e.name.length - b.e.name.length ||
      a.e.name.localeCompare(b.e.name) ||
      (a.e.char < b.e.char ? -1 : a.e.char > b.e.char ? 1 : 0),
  );
  const ranked = scored.map((x) => x.e);

  // Phase 2 — typo-tolerant fuzzy pass over name tokens, appended AFTER precise matches
  // so clean queries keep their crisp top hits. Gated to ≥3-char queries (shorter ones
  // are well served by the tiered matches and would fuzz too loosely).
  if (q.length >= 3) {
    const max = maxEditsFor(q.length);
    const fuzzy: { e: EmojiEntry; d: number }[] = [];
    for (const e of entries) {
      if (exactChars.has(e.char)) continue; // already in phase 1
      const d = fuzzyDistance(e, q, max);
      if (d <= max) fuzzy.push({ e, d });
    }
    // closer edit distance first, then popularity, then shorter shortcode, then codepoint.
    fuzzy.sort(
      (a, b) =>
        a.d - b.d ||
        popRank(a.e.name) - popRank(b.e.name) ||
        a.e.name.length - b.e.name.length ||
        (a.e.char < b.e.char ? -1 : a.e.char > b.e.char ? 1 : 0),
    );
    ranked.push(...fuzzy.map((x) => x.e));
  }

  return dedupeByChar(ranked, limit);
}

// Ranked search over the bundled dataset.
export function searchEmoji(query: string, limit = 50): EmojiEntry[] {
  return rankEmoji(EMOJI_DATA, query, limit);
}
