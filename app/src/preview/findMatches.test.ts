// app/src/preview/findMatches.test.ts
import { describe, expect, test } from "bun:test";
import { findMatches, segmentText, stepMatchIndex } from "./findMatches";

describe("findMatches", () => {
  test("empty query yields no matches", () => {
    expect(findMatches("hello world", "", false)).toEqual([]);
  });

  test("case-insensitive by default", () => {
    expect(findMatches("Foo foo FOO", "foo", false)).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  test("case-sensitive only matches exact casing", () => {
    expect(findMatches("Foo foo FOO", "foo", true)).toEqual([{ from: 4, to: 7 }]);
  });

  test("non-overlapping: 'aa' in 'aaaa' matches twice, not three times", () => {
    expect(findMatches("aaaa", "aa", false)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  test("no match returns empty", () => {
    expect(findMatches("abcdef", "xyz", false)).toEqual([]);
  });

  test("limit caps the number of matches returned", () => {
    expect(findMatches("a a a a a", "a", false, 2)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
  });

  test("limit <= 0 returns nothing", () => {
    expect(findMatches("aaa", "a", false, 0)).toEqual([]);
  });

  test("matches across newlines (whole-file substring search)", () => {
    expect(findMatches("line one\nline two", "line", false)).toEqual([
      { from: 0, to: 4 },
      { from: 9, to: 13 },
    ]);
  });
});

describe("segmentText", () => {
  test("no matches → single plain segment", () => {
    expect(segmentText("hello", [])).toEqual([{ text: "hello", matchIndex: -1 }]);
  });

  test("alternates plain and match runs with 0-based match indices", () => {
    const text = "Foo foo FOO";
    const segs = segmentText(text, findMatches(text, "foo", false));
    expect(segs).toEqual([
      { text: "Foo", matchIndex: 0 },
      { text: " ", matchIndex: -1 },
      { text: "foo", matchIndex: 1 },
      { text: " ", matchIndex: -1 },
      { text: "FOO", matchIndex: 2 },
    ]);
  });

  test("match at the very start has no leading plain segment", () => {
    const segs = segmentText("abcabc", findMatches("abcabc", "abc", false));
    expect(segs).toEqual([
      { text: "abc", matchIndex: 0 },
      { text: "abc", matchIndex: 1 },
    ]);
  });

  test("segments losslessly reproduce the original text", () => {
    const text = "the quick brown fox, the lazy dog";
    const segs = segmentText(text, findMatches(text, "the", false));
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });
});

describe("stepMatchIndex", () => {
  test("next wraps past the end back to 0", () => {
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
  });

  test("prev wraps below 0 to the last", () => {
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
  });

  test("plain forward/back within range", () => {
    expect(stepMatchIndex(0, 3, 1)).toBe(1);
    expect(stepMatchIndex(2, 3, -1)).toBe(1);
  });

  test("no matches → 0", () => {
    expect(stepMatchIndex(5, 0, 1)).toBe(0);
  });
});
