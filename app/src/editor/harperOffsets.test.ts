// app/src/editor/harperOffsets.test.ts
import { test, expect } from "bun:test";
import { scalarToUtf16 } from "./harperOffsets";

test("scalarToUtf16: pure-ASCII text maps 1:1", () => {
  const text = "hello wrold"; // "wrold" misspelled, scalar idx 6
  expect(scalarToUtf16(text, 0)).toBe(0);
  expect(scalarToUtf16(text, 6)).toBe(6);
  expect(scalarToUtf16(text, 11)).toBe(11);
});

test("scalarToUtf16: an astral char before the target shifts the UTF-16 offset by +1", () => {
  // "👍 teh" — the emoji is 1 Unicode scalar but 2 UTF-16 code units.
  // Scalar layout:  👍=0  (space)=1  t=2 e=3 h=4   -> length 5 scalars
  // UTF-16 layout:  👍=0,1  (space)=2  t=3 e=4 h=5 -> length 6 units
  const text = "👍 teh";
  expect(scalarToUtf16(text, 0)).toBe(0); // start of emoji
  expect(scalarToUtf16(text, 1)).toBe(2); // the space, after the 2-unit emoji
  expect(scalarToUtf16(text, 2)).toBe(3); // 't' of the misspelled "teh"
  expect(scalarToUtf16(text, 5)).toBe(6); // end-of-text (scalar length 5 -> utf16 length 6)
});

test("scalarToUtf16: multiple astral chars accumulate the shift", () => {
  // "😀😀x" — two emoji (2 scalars / 4 units), then 'x'
  const text = "😀😀x";
  expect(scalarToUtf16(text, 0)).toBe(0);
  expect(scalarToUtf16(text, 1)).toBe(2);
  expect(scalarToUtf16(text, 2)).toBe(4); // the 'x'
  expect(scalarToUtf16(text, 3)).toBe(5); // end
});

test("scalarToUtf16: a scalar index past the end clamps to the UTF-16 length", () => {
  const text = "ab";
  expect(scalarToUtf16(text, 99)).toBe(2);
});
