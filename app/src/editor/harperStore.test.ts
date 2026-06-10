// app/src/editor/harperStore.test.ts
import { test, expect, beforeEach } from "bun:test";
import { loadHarperState, addWord, removeWord, addIgnoredLint, normalizeDictWord, __setStorage } from "./harperStore";

// Minimal in-memory localStorage stand-in for the headless test runner.
function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

let store: ReturnType<typeof memStorage>;
beforeEach(() => {
  store = memStorage();
  __setStorage(store as unknown as Storage);
});

test("loadHarperState: empty storage yields empty words + ignores", () => {
  expect(loadHarperState()).toEqual({ words: [], ignoredLints: [] });
});

test("addWord: appends, dedupes, and persists", () => {
  addWord("teh");
  addWord("teh"); // duplicate ignored
  addWord("foo");
  expect(loadHarperState().words).toEqual(["teh", "foo"]);
});

test("normalizeDictWord: lowercases + trims so the entry is case-insensitive", () => {
  expect(normalizeDictWord("  Bismuth ")).toBe("bismuth");
  expect(normalizeDictWord("ZORBLAX")).toBe("zorblax");
});

test("addWord: stores the lowercased form and dedupes across casings", () => {
  // Right-clicking a capitalized occurrence (proper noun / sentence start) must
  // still produce a case-insensitive entry, and not a near-duplicate.
  addWord("Bismuth");
  addWord("bismuth"); // same word, lowercase — already present
  addWord("ZORBLAX");
  expect(loadHarperState().words).toEqual(["bismuth", "zorblax"]);
});

test("removeWord: deletes by the normalized form, regardless of casing passed", () => {
  addWord("bismuth");
  addWord("zorblax");
  // remove using a different casing than stored — still matches the canonical form
  removeWord("ZORBLAX");
  expect(loadHarperState().words).toEqual(["bismuth"]);
});

test("removeWord: removing an absent word is a no-op; leaves ignoredLints intact", () => {
  addWord("foo");
  addIgnoredLint("hash-1");
  removeWord("nope");
  expect(loadHarperState()).toEqual({ words: ["foo"], ignoredLints: ["hash-1"] });
});

test("addIgnoredLint: appends and persists the lint hash", () => {
  addIgnoredLint("hash-abc");
  addIgnoredLint("hash-def");
  expect(loadHarperState().ignoredLints).toEqual(["hash-abc", "hash-def"]);
});

test("loadHarperState: corrupt JSON degrades to empty state", () => {
  store._map.set("three-brains.harper", "{not json");
  expect(loadHarperState()).toEqual({ words: [], ignoredLints: [] });
});
