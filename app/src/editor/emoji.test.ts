import { test, expect } from "bun:test";
import { matchEmojiPrefix, rankEmoji, searchEmoji, EMOJI_DATA, type EmojiEntry } from "./emoji";

// --- matchEmojiPrefix ----------------------------------------------------------

test("matchEmojiPrefix: bare query at line start", () => {
  // ":smi" — from at the colon (0), to at cursor (4), query "smi".
  expect(matchEmojiPrefix(":smi")).toEqual({ from: 0, to: 4, query: "smi" });
});

test("matchEmojiPrefix: after whitespace, from points at the colon", () => {
  // "hi :sm" — colon at index 3.
  expect(matchEmojiPrefix("hi :sm")).toEqual({ from: 3, to: 6, query: "sm" });
});

test("matchEmojiPrefix: closing colon is consumed but not part of the query", () => {
  // ":smile:" — to spans the closing colon so accepting replaces it.
  expect(matchEmojiPrefix(":smile:")).toEqual({ from: 0, to: 7, query: "smile" });
});

test("matchEmojiPrefix: allows + and - (e.g. :+1:)", () => {
  expect(matchEmojiPrefix(":+1")).toEqual({ from: 0, to: 3, query: "+1" });
  expect(matchEmojiPrefix(":-1:")).toEqual({ from: 0, to: 4, query: "-1" });
});

test("matchEmojiPrefix: allows underscores (special-char shortcodes)", () => {
  expect(matchEmojiPrefix(":arrow_right")).toEqual({ from: 0, to: 12, query: "arrow_right" });
});

test("matchEmojiPrefix: a lone colon matches an empty query (instant popup)", () => {
  expect(matchEmojiPrefix(":")).toEqual({ from: 0, to: 1, query: "" });
  expect(matchEmojiPrefix("hi :")).toEqual({ from: 3, to: 4, query: "" });
});

test("matchEmojiPrefix: null when the colon follows a word char (key:, http://, 12:30)", () => {
  expect(matchEmojiPrefix("key: value")).toBeNull();
  expect(matchEmojiPrefix("http://x")).toBeNull();
  expect(matchEmojiPrefix("12:30")).toBeNull();
  expect(matchEmojiPrefix("Note:")).toBeNull(); // colon right after a word — not an emoji trigger
});

test("matchEmojiPrefix: a double colon matches an empty query", () => {
  expect(matchEmojiPrefix("::")).toEqual({ from: 0, to: 2, query: "" });
});

// --- rankEmoji (pure, fixture) -------------------------------------------------

const FIXTURE: EmojiEntry[] = [
  { char: "😄", name: "grinning_face", keywords: ["happy", "joy", "smile", "grin"] },
  { char: "😀", name: "grin", keywords: ["happy", "smile"] },
  { char: "🙂", name: "slightly_smiling_face", keywords: ["smile", "content"] },
  { char: "—", name: "emdash", keywords: ["em", "dash", "punctuation"] },
];

test("rankEmoji: exact shortcode beats prefix beats keyword", () => {
  // query "grin" — exact name "grin" (score 0) outranks prefix "grinning_face" (1).
  const r = rankEmoji(FIXTURE, "grin");
  expect(r[0].char).toBe("😀");
  expect(r[1].char).toBe("😄");
});

test("rankEmoji: keyword match surfaces an emoji whose shortcode differs", () => {
  // "happy" is only a keyword (no shortcode contains it) yet still finds the faces.
  const chars = rankEmoji(FIXTURE, "happy").map((e) => e.char);
  expect(chars).toContain("😄");
  expect(chars).toContain("😀");
});

test("rankEmoji: special-character lookup by shortcode", () => {
  expect(rankEmoji(FIXTURE, "emdash")[0].char).toBe("—");
});

test("rankEmoji: empty query returns the popular entries present, in popularity order", () => {
  // FIXTURE contains two curated populars (grinning_face, slightly_smiling_face); a lone
  // ":" surfaces them ordered by popularity, not the non-popular `grin`/`emdash`.
  expect(rankEmoji(FIXTURE, "").map((e) => e.name)).toEqual(["grinning_face", "slightly_smiling_face"]);
  expect(rankEmoji(FIXTURE, "   ").map((e) => e.name)).toEqual(["grinning_face", "slightly_smiling_face"]);
});

test("rankEmoji: among equal-score matches, the more popular one ranks first", () => {
  const items: EmojiEntry[] = [
    { char: "🅰", name: "zzz_obscure", keywords: ["smile"] }, // not curated → low priority
    { char: "😄", name: "grinning_face", keywords: ["smile"] }, // curated popular
  ];
  expect(rankEmoji(items, "smile")[0].char).toBe("😄");
});

test("rankEmoji: punctuation-only queries are rejected; :+1 / :-1 still resolve", () => {
  expect(rankEmoji(FIXTURE, "-")).toEqual([]);
  expect(rankEmoji(FIXTURE, "+")).toEqual([]);
  expect(rankEmoji(FIXTURE, "_")).toEqual([]);
  // a digit keeps it a real search against the real dataset
  expect(searchEmoji("+1").length).toBeGreaterThan(0);
  expect(searchEmoji("-1").length).toBeGreaterThan(0);
});

test("rankEmoji: dual-glyph shortcodes resolve deterministically by codepoint", () => {
  const items: EmojiEntry[] = [
    { char: "➗", name: "divide", keywords: ["divide"] }, // U+2797
    { char: "÷", name: "divide", keywords: ["divide"] }, // U+00F7
  ];
  // Both score 0 on the exact name; the codepoint tie-break is total, so the order is
  // fixed regardless of input order — ÷ (U+00F7) sorts before ➗ (U+2797).
  expect(rankEmoji(items, "divide").map((e) => e.char)).toEqual(["÷", "➗"]);
  expect(rankEmoji([...items].reverse(), "divide").map((e) => e.char)).toEqual(["÷", "➗"]);
});

test("dataset: every curated POPULAR shortcode resolves (catches silent drops)", () => {
  // The empty-query popup IS the curated most-used set; a missing slug would be silently
  // skipped, shrinking this. We curate 41 char-unique entries — catch a mass drop.
  expect(searchEmoji("").length).toBeGreaterThanOrEqual(40);
});

test("dataset: dual-glyph shortcodes resolve deterministically, typographic char first", () => {
  // 6 shortcodes carry both an emoji and a hand-authored typographic glyph. The codepoint
  // tie-break fixes the order — the lower-codepoint typographic char leads, the emoji
  // follows, and both stay reachable. Regression guard for the "shadowing" review finding.
  const pairs: [string, string, string][] = [
    ["divide", "÷", "➗"],
    ["cross_mark", "✗", "❌"],
    ["dagger", "†", "🗡️"],
    ["copyright", "©", "©️"],
    ["registered", "®", "®️"],
    ["infinity", "∞", "♾️"],
  ];
  for (const [name, first, second] of pairs) {
    expect(searchEmoji(name).slice(0, 2).map((e) => e.char)).toEqual([first, second]);
  }
});

test("rankEmoji: respects the limit", () => {
  // "smile" matches three entries; limit 2 caps it.
  expect(rankEmoji(FIXTURE, "smile", 2).length).toBe(2);
});

test("rankEmoji: dedupes by glyph (alias shortcodes for one char)", () => {
  const dup: EmojiEntry[] = [
    { char: "→", name: "arrow_right", keywords: ["arrow", "right"] },
    { char: "→", name: "rightarrow", keywords: ["arrow", "right"] },
  ];
  expect(rankEmoji(dup, "arrow").length).toBe(1);
});

// --- searchEmoji + dataset integrity (real bundled data) -----------------------

test("dataset: bundled and non-trivial", () => {
  expect(EMOJI_DATA.length).toBeGreaterThan(500);
});

test("dataset: every entry has a glyph, a shortcode, and keywords", () => {
  for (const e of EMOJI_DATA) {
    expect(typeof e.char).toBe("string");
    expect(e.char.length).toBeGreaterThan(0);
    expect(e.name.length).toBeGreaterThan(0);
    expect(Array.isArray(e.keywords)).toBe(true);
  }
});

test("searchEmoji: keyword search works against real data", () => {
  // "happy" should surface at least one smiling face from the real emoji set.
  expect(searchEmoji("happy").length).toBeGreaterThan(0);
});

test("searchEmoji: a lone colon (empty query) returns the curated popular set", () => {
  const r = searchEmoji("");
  expect(r.length).toBeGreaterThan(10);
  expect(r.length).toBeLessThanOrEqual(50);
  expect(r[0].char).toBe("😂"); // face_with_tears_of_joy is #1 most-used
});

test("searchEmoji: special characters are present in the real dataset", () => {
  expect(searchEmoji("emdash")[0]?.char).toBe("—");
  expect(searchEmoji("arrow_right")[0]?.char).toBe("→");
  expect(searchEmoji("approx")[0]?.char).toBe("≈");
});
