// app/src/editor/blockLocate.ts
//
// "Which embedded block is this widget?" — the one rule shared by the two embedded-block
// extensions (queryBlock.ts's ```query and graphBlock.ts's ```graph). Both replace a fence
// with a widget, and both must map that widget's DOM node back to its fence: `reveal()`
// needs the block's index (to toggle it open) and graphBlock's `write()` needs its range
// (to rewrite its body). Get that mapping wrong and a widget acts on the WRONG fence.
//
// Pure (no CodeMirror `view`, no DOM) so the rule is unit-testable on its own — see
// blockLocate.test.ts. That matters because the bug this replaces was invisible from both
// sides: the pure DSL tests couldn't see the widget layer, and the widget tests all used
// fences separated by a BLANK line, which is exactly the spacing that hides it.
//
// THE BUG (both files, identically): `pos >= r.from && pos <= r.to + 1`. Fence ranges are
// half-open — `to` is the position just past the closing ```, so a block starting on the
// very next line has `from === to + 1`. The `+1` therefore made every range overlap its
// successor's first position, and `findIndex` returns the FIRST match, so the second of two
// adjacent blocks located itself as the first. In graphBlock that is silent data loss:
// editing graph #2 wrote its body into graph #1's fence, mangling a block the user never
// touched, with no error. `+1` had no legitimate job — a caret at the end of a range is at
// `to` (exclusive end), which plain `<= to` already covers.

/** The minimum a locatable block range must expose. Both QueryRange and GraphRange satisfy
 *  it structurally; each keeps its own extra fields (bodyFrom/body). */
export interface BlockRange {
  from: number;
  /** Exclusive end — the position just past the closing fence. */
  to: number;
}

/**
 * Index of the block at `pos` in document order, or -1 if none.
 *
 * `pos` is a widget's `view.posAtDOM(dom)`, which for a block-replacing widget is its
 * range's `from` EXACTLY — so identity, not containment, is the real answer, and it is
 * tried first. Containment (`from <= pos <= to`) is only a fallback for a `pos` that lands
 * inside a range without being its start; it is strict on purpose, and it cannot be
 * ambiguous: fence ranges are disjoint and every pair is separated by at least the newline
 * ending the closing fence, so `to < nextFrom` always holds and no `pos` satisfies two.
 *
 * Both passes failing returns -1 — the caller must then do NOTHING. Refusing to act beats
 * guessing a neighbour: a no-op is visible and recoverable, a write to the wrong fence is
 * neither.
 */
export function locateBlockIndex(ranges: readonly BlockRange[], pos: number): number {
  const exact = ranges.findIndex((r) => r.from === pos);
  if (exact >= 0) return exact;
  return ranges.findIndex((r) => pos >= r.from && pos <= r.to);
}
