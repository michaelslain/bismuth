// scripts/gen-emoji.ts
//
// One-shot generator for the emoji + special-character autocomplete dataset.
// Run with `bun run scripts/gen-emoji.ts`; it writes app/src/editor/emoji-data.json.
//
// The committed JSON is the RUNTIME artifact — the app has zero runtime emoji
// dependency. `emojilib` + `unicode-emoji-json` are devDependencies used only here.
//
//   unicode-emoji-json → authoritative emoji char + slug (the shortcode) + human name + group
//   emojilib           → keyword arrays per emoji char
//   SPECIAL_CHARS      → hand-authored typographic / math / arrow / currency symbols
//
// Output entries are EmojiEntry (imported from app/src/editor/emoji.ts — one source of
// truth): `name` is the shortcode (slug, underscored); `keywords` is everything searchable.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EmojiEntry } from "../app/src/editor/emoji"; // single source of truth for the shape

// --- defensive module loading (CJS default-export shapes vary) -------------------
function unwrap<T>(m: any): T {
  return (m && m.default && typeof m.default === "object" ? m.default : m) as T;
}
const emojilib = unwrap<Record<string, string[]>>(await import("emojilib"));
const byEmoji = unwrap<Record<string, { name: string; slug: string; group?: string }>>(
  await import("unicode-emoji-json"),
);

// Normalize a free-text token to a lowercase keyword.
function kw(s: string): string {
  return s.toLowerCase().trim();
}
// Build a slug from a human name when a real slug is missing.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

// --- emoji entries from unicode-emoji-json + emojilib ---------------------------
const emojiEntries: EmojiEntry[] = [];
for (const [char, meta] of Object.entries(byEmoji)) {
  const slug = meta.slug ? meta.slug : slugify(meta.name ?? "");
  if (!slug) continue;
  const fromLib = Array.isArray(emojilib[char]) ? emojilib[char] : [];
  const nameWords = (meta.name ?? "").split(/\s+/);
  const groupWords = (meta.group ?? "").split(/\s+/);
  const keywords = dedupe(
    [slug, slug.replace(/_/g, " "), ...fromLib, ...nameWords, ...groupWords].map(kw),
  );
  emojiEntries.push({ char, name: slug, keywords });
}

// --- hand-authored special characters -------------------------------------------
// shortcode (name) + extra search keywords. Slug rules match emoji (underscored).
const SPECIAL_CHARS: { char: string; name: string; keywords: string[] }[] = [
  // arrows
  { char: "→", name: "arrow_right", keywords: ["arrow", "right", "rightwards"] },
  { char: "←", name: "arrow_left", keywords: ["arrow", "left", "leftwards"] },
  { char: "↑", name: "arrow_up", keywords: ["arrow", "up", "upwards"] },
  { char: "↓", name: "arrow_down", keywords: ["arrow", "down", "downwards"] },
  { char: "↔", name: "arrow_left_right", keywords: ["arrow", "leftright", "horizontal"] },
  { char: "↕", name: "arrow_up_down", keywords: ["arrow", "updown", "vertical"] },
  { char: "⇒", name: "double_arrow_right", keywords: ["arrow", "implies", "then", "right"] },
  { char: "⇐", name: "double_arrow_left", keywords: ["arrow", "left", "double"] },
  { char: "⇔", name: "double_arrow_left_right", keywords: ["arrow", "iff", "equivalent"] },
  { char: "↦", name: "maps_to", keywords: ["arrow", "mapsto", "function"] },
  // typographic
  { char: "—", name: "emdash", keywords: ["em", "dash", "hyphen", "punctuation", "long"] },
  { char: "–", name: "endash", keywords: ["en", "dash", "hyphen", "range", "punctuation"] },
  { char: "…", name: "ellipsis", keywords: ["dots", "ellipsis", "etc", "horizontal"] },
  { char: "“", name: "ldquo", keywords: ["left", "double", "quote", "curly", "smart"] },
  { char: "”", name: "rdquo", keywords: ["right", "double", "quote", "curly", "smart"] },
  { char: "‘", name: "lsquo", keywords: ["left", "single", "quote", "curly", "apostrophe"] },
  { char: "’", name: "rsquo", keywords: ["right", "single", "quote", "curly", "apostrophe"] },
  { char: "«", name: "laquo", keywords: ["left", "guillemet", "angle", "quote"] },
  { char: "»", name: "raquo", keywords: ["right", "guillemet", "angle", "quote"] },
  { char: "•", name: "bullet", keywords: ["bullet", "dot", "list", "point"] },
  { char: "·", name: "middot", keywords: ["middle", "dot", "interpunct"] },
  { char: "§", name: "section", keywords: ["section", "legal", "paragraph"] },
  { char: "¶", name: "pilcrow", keywords: ["paragraph", "pilcrow"] },
  { char: "†", name: "dagger", keywords: ["dagger", "cross", "footnote"] },
  { char: "‡", name: "double_dagger", keywords: ["dagger", "double", "footnote"] },
  { char: "©", name: "copyright", keywords: ["copyright", "legal", "c"] },
  { char: "®", name: "registered", keywords: ["registered", "trademark", "legal", "r"] },
  { char: "™", name: "trademark", keywords: ["trademark", "tm", "legal"] },
  { char: "°", name: "degree", keywords: ["degree", "temperature", "angle"] },
  { char: "′", name: "prime", keywords: ["prime", "minute", "feet"] },
  { char: "″", name: "double_prime", keywords: ["double", "prime", "second", "inch"] },
  // math
  { char: "±", name: "plus_minus", keywords: ["plus", "minus", "plusminus", "tolerance"] },
  { char: "×", name: "times", keywords: ["times", "multiply", "multiplication", "cross", "x"] },
  { char: "÷", name: "divide", keywords: ["divide", "division", "obelus"] },
  { char: "≈", name: "approx", keywords: ["approximately", "approx", "almost", "equal"] },
  { char: "≠", name: "not_equal", keywords: ["not", "equal", "unequal", "ne"] },
  { char: "≡", name: "identical", keywords: ["identical", "equivalent", "congruent"] },
  { char: "≤", name: "less_equal", keywords: ["less", "than", "equal", "lte"] },
  { char: "≥", name: "greater_equal", keywords: ["greater", "than", "equal", "gte"] },
  { char: "∞", name: "infinity", keywords: ["infinity", "infinite", "forever"] },
  { char: "√", name: "sqrt", keywords: ["square", "root", "radical", "sqrt"] },
  { char: "∑", name: "sum", keywords: ["sum", "sigma", "summation", "total"] },
  { char: "∏", name: "product", keywords: ["product", "pi", "capital"] },
  { char: "∫", name: "integral", keywords: ["integral", "calculus"] },
  { char: "∂", name: "partial", keywords: ["partial", "derivative", "calculus"] },
  { char: "∆", name: "delta", keywords: ["delta", "change", "difference", "triangle"] },
  { char: "∇", name: "nabla", keywords: ["nabla", "del", "gradient"] },
  { char: "π", name: "pi", keywords: ["pi", "circle", "constant"] },
  { char: "µ", name: "micro", keywords: ["micro", "mu", "micron"] },
  { char: "∈", name: "element_of", keywords: ["element", "member", "in", "set"] },
  { char: "∉", name: "not_element_of", keywords: ["not", "element", "member", "set"] },
  { char: "∀", name: "for_all", keywords: ["for", "all", "universal"] },
  { char: "∃", name: "exists", keywords: ["exists", "there", "existential"] },
  { char: "∅", name: "empty_set", keywords: ["empty", "set", "null"] },
  { char: "∩", name: "intersection", keywords: ["intersection", "and", "cap", "set"] },
  { char: "∪", name: "union", keywords: ["union", "or", "cup", "set"] },
  { char: "⊂", name: "subset", keywords: ["subset", "set", "contained"] },
  { char: "⊃", name: "superset", keywords: ["superset", "set", "contains"] },
  // checks / marks
  { char: "✓", name: "check", keywords: ["check", "tick", "yes", "done", "correct"] },
  { char: "✔", name: "heavy_check", keywords: ["check", "tick", "yes", "done", "bold"] },
  { char: "✗", name: "cross_mark", keywords: ["cross", "x", "no", "wrong", "incorrect"] },
  { char: "✘", name: "heavy_cross", keywords: ["cross", "x", "no", "wrong", "bold"] },
  { char: "☑", name: "ballot_check", keywords: ["checkbox", "checked", "ballot", "done"] },
  { char: "☐", name: "ballot_empty", keywords: ["checkbox", "empty", "ballot", "todo"] },
  { char: "★", name: "star_filled", keywords: ["star", "filled", "favorite", "rating"] },
  { char: "☆", name: "star_empty", keywords: ["star", "empty", "outline", "rating"] },
  // currency
  { char: "€", name: "euro", keywords: ["euro", "currency", "money", "eur"] },
  { char: "£", name: "pound", keywords: ["pound", "sterling", "currency", "money", "gbp"] },
  { char: "¥", name: "yen", keywords: ["yen", "yuan", "currency", "money", "jpy", "cny"] },
  { char: "¢", name: "cent", keywords: ["cent", "currency", "money", "penny"] },
  { char: "₿", name: "bitcoin", keywords: ["bitcoin", "btc", "crypto", "currency", "money"] },
  { char: "₹", name: "rupee", keywords: ["rupee", "currency", "money", "inr", "india"] },
  // misc
  { char: "≅", name: "congruent", keywords: ["congruent", "approximately", "equal"] },
  { char: "∝", name: "proportional", keywords: ["proportional", "varies"] },
  { char: "⊕", name: "circled_plus", keywords: ["xor", "plus", "circled", "direct", "sum"] },
  { char: "⊗", name: "circled_times", keywords: ["tensor", "times", "circled", "product"] },
];

const specialEntries: EmojiEntry[] = SPECIAL_CHARS.map((s) => ({
  char: s.char,
  name: s.name,
  keywords: dedupe([s.name, s.name.replace(/_/g, " "), ...s.keywords].map(kw)),
}));

const all: EmojiEntry[] = [...emojiEntries, ...specialEntries];

const outPath = join(import.meta.dir, "..", "app", "src", "editor", "emoji-data.json");
writeFileSync(outPath, JSON.stringify(all));

// Summary.
const summary = [
  `emoji entries: ${emojiEntries.length}`,
  `special entries: ${specialEntries.length}`,
  `total: ${all.length}`,
  `bytes: ${JSON.stringify(all).length}`,
  `sample emoji: ${JSON.stringify(emojiEntries.find((e) => e.name === "grinning_face") ?? emojiEntries[0])}`,
  `sample special: ${JSON.stringify(specialEntries.find((e) => e.name === "emdash"))}`,
].join("\n");
console.log(summary);
