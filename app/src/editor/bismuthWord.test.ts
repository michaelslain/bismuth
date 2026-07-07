import { test, expect, describe } from "bun:test";
import { findBismuthWords, wrapBismuthWords, BISMUTH_SCAN_RE } from "./bismuthWord";

describe("findBismuthWords", () => {
  test("a lone 'bismuth' matches once, spanning the whole word", () => {
    expect(findBismuthWords("bismuth")).toEqual([{ from: 0, to: 7 }]);
  });

  test("is case-insensitive and finds every occurrence", () => {
    expect(findBismuthWords("Bismuth is BISMUTH, bismuth")).toEqual([
      { from: 0, to: 7 },
      { from: 11, to: 18 },
      { from: 20, to: 27 },
    ]);
  });

  test("respects word boundaries — no partial-word matches", () => {
    expect(findBismuthWords("bismuths")).toEqual([]); // trailing letter
    expect(findBismuthWords("embismuth")).toEqual([]); // leading letters
    expect(findBismuthWords("bismuth2")).toEqual([]); // trailing digit
    expect(findBismuthWords("2bismuth")).toEqual([]); // leading digit
  });

  test("punctuation / hyphens are boundaries, so an adjacent word still matches", () => {
    expect(findBismuthWords("bismuth-crystal")).toEqual([{ from: 0, to: 7 }]);
    expect(findBismuthWords("(bismuth)")).toEqual([{ from: 1, to: 8 }]);
    expect(findBismuthWords("#bismuth")).toEqual([{ from: 1, to: 8 }]);
  });

  test("returns nothing for text without the word", () => {
    expect(findBismuthWords("just some ordinary prose")).toEqual([]);
  });
});

describe("wrapBismuthWords", () => {
  test("wraps every occurrence via the callback, preserving case and surrounding text", () => {
    const out = wrapBismuthWords("Bismuth vs bismuth", (w) => `<b>${w}</b>`);
    expect(out).toBe("<b>Bismuth</b> vs <b>bismuth</b>");
  });

  test("leaves partial-word matches untouched", () => {
    expect(wrapBismuthWords("bismuths embismuth", (w) => `<b>${w}</b>`)).toBe("bismuths embismuth");
  });
});

describe("BISMUTH_SCAN_RE", () => {
  test("is a stateless gate that finds a boundary-valid occurrence but skips embedded ones", () => {
    expect(BISMUTH_SCAN_RE.test("a bismuth here")).toBe(true);
    expect(BISMUTH_SCAN_RE.test("embismuth")).toBe(false);
    expect(BISMUTH_SCAN_RE.test("plain prose")).toBe(false);
  });
});
