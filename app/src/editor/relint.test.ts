// app/src/editor/relint.test.ts
import { test, expect } from "bun:test";
import { StateEffect } from "@codemirror/state";
import { relintEffect, relintNeedsRefresh } from "./relint";

// relintNeedsRefresh only reads update.transactions[].effects[].is(...), so a minimal
// shape stands in for a real ViewUpdate.
const update = (txEffects: StateEffect<unknown>[][]) =>
  ({ transactions: txEffects.map((effects) => ({ effects })) }) as never;

test("relintNeedsRefresh: true when a transaction carries relintEffect", () => {
  expect(relintNeedsRefresh(update([[relintEffect.of(null)]]))).toBe(true);
  // also true if the effect rides alongside others in the same transaction
  const other = StateEffect.define<number>();
  expect(relintNeedsRefresh(update([[other.of(1), relintEffect.of(null)]]))).toBe(true);
});

test("relintNeedsRefresh: false for unrelated effects or no transactions", () => {
  const other = StateEffect.define<number>();
  expect(relintNeedsRefresh(update([[other.of(1)]]))).toBe(false);
  expect(relintNeedsRefresh(update([[]]))).toBe(false);
  expect(relintNeedsRefresh(update([]))).toBe(false);
});
