// app/src/palette/rankItems.test.ts
import { test, expect } from "bun:test";
import { rankItems, toSegments, type PaletteItem } from "./rankItems";

const items: PaletteItem[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
  { id: "d", label: "Alphabet" },
];

test("empty query returns items in incoming order without frecency", () => {
  const r = rankItems(items, "");
  expect(r.map((m) => m.item.id)).toEqual(["a", "b", "c", "d"]);
  // No fuzzy indices on an empty query.
  expect(r.every((m) => m.indices.length === 0)).toBe(true);
});

test("empty query with frecency lists most-frecent first (stable for ties)", () => {
  const frec: Record<string, number> = { c: 5, b: 2 };
  const r = rankItems(items, "", (id) => frec[id] ?? 0);
  // c (5) then b (2), then the zero-score rest keep their incoming order (a, d).
  expect(r.map((m) => m.item.id)).toEqual(["c", "b", "a", "d"]);
});

test("query fuzzy-matches and returns matched-char indices", () => {
  const r = rankItems(items, "alph");
  const ids = r.map((m) => m.item.id);
  expect(ids).toContain("a"); // "Alpha"
  expect(ids).toContain("d"); // "Alphabet"
  expect(ids).not.toContain("b"); // "Beta" is not a match
  const alpha = r.find((m) => m.item.id === "a")!;
  expect(alpha.indices.length).toBeGreaterThan(0);
});

test("frecency breaks ties among equally-good matches", () => {
  const two: PaletteItem[] = [
    { id: "x", label: "Note One" },
    { id: "y", label: "Note Two" },
  ];
  // Both match "note" identically (same prefix), so frecency decides the order.
  const r = rankItems(two, "note", (id) => (id === "y" ? 10 : 0));
  expect(r[0].item.id).toBe("y");
});

test("frecency never overtakes a decisively better text match", () => {
  // "Alphabet" is a near-perfect match for "alphabet" while "Alpha" is a weak/non match;
  // even a huge frecency boost on "Alpha" can't float it above "Alphabet".
  const r = rankItems(items, "alphabet", (id) => (id === "a" ? 100 : 0));
  expect(r[0].item.id).toBe("d");
});

test("toSegments splits a label into alternating matched/unmatched runs", () => {
  const segs = toSegments("Alpha", [0, 1]);
  expect(segs).toEqual([
    { text: "Al", match: true },
    { text: "pha", match: false },
  ]);
  expect(toSegments("Alpha", [])).toEqual([{ text: "Alpha", match: false }]);
});
