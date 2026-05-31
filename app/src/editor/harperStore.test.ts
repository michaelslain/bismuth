// app/src/editor/harperStore.test.ts
import { test, expect, beforeEach } from "bun:test";
import { loadHarperState, addWord, addIgnoredLint, __setStorage } from "./harperStore";

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

test("addIgnoredLint: appends and persists the lint hash", () => {
  addIgnoredLint("hash-abc");
  addIgnoredLint("hash-def");
  expect(loadHarperState().ignoredLints).toEqual(["hash-abc", "hash-def"]);
});

test("loadHarperState: corrupt JSON degrades to empty state", () => {
  store._map.set("three-brains.harper", "{not json");
  expect(loadHarperState()).toEqual({ words: [], ignoredLints: [] });
});
