// app/src/editor/harper.test.ts
// Unit tests for the pure span-revalidation guard used by Harper quick-fixes.
// (The WASM glue in harper.ts is exercised in-browser; here we cover only the
// pure offset-safety logic that prevents stale quick-fixes from corrupting text.)
import { test, expect } from "bun:test";
import { spanStillMatches, type DocSlicer } from "./harper";

// Minimal EditorView stand-in: just the doc.sliceString CM exposes, with the
// real clamping behaviour (out-of-range offsets clamp to [0, length]).
function docView(text: string): DocSlicer {
  return {
    state: {
      doc: {
        sliceString(from: number, to: number) {
          const len = text.length;
          const f = Math.max(0, Math.min(from, len));
          const t = Math.max(f, Math.min(to, len));
          return text.slice(f, t);
        },
      },
    },
  };
}

test("spanStillMatches: unchanged span still holds the flagged text", () => {
  const view = docView("the wrold is round");
  // "wrold" sits at [4, 9)
  expect(spanStillMatches(view, 4, 9, "wrold")).toBe(true);
});

test("spanStillMatches: doc edited before the span shifts offsets — guard fails", () => {
  // User typed text earlier in the doc, so the baked-in [4,9) now points at
  // unrelated characters. Applying the fix here would overwrite the wrong span.
  const view = docView("PREFIX the wrold is round");
  expect(spanStillMatches(view, 4, 9, "wrold")).toBe(false);
});

test("spanStillMatches: span replaced/deleted — guard fails", () => {
  // The misspelling was already corrected/removed by another edit.
  const view = docView("the round world");
  expect(spanStillMatches(view, 4, 9, "wrold")).toBe(false);
});

test("spanStillMatches: offsets now past end-of-document — guard fails, no throw", () => {
  // Doc shrank below the baked-in offsets; sliceString clamps, returning a
  // shorter string that cannot equal the original flagged text.
  const view = docView("hi");
  expect(spanStillMatches(view, 4, 9, "wrold")).toBe(false);
});

test("spanStillMatches: same length but different text at the span — guard fails", () => {
  const view = docView("the WORLD is round"); // 5 chars at [4,9), but not "wrold"
  expect(spanStillMatches(view, 4, 9, "wrold")).toBe(false);
});
