import { describe, expect, test } from "bun:test";
import { appendOrder } from "./kanbanOrder";

describe("appendOrder", () => {
  // NOTE: appendOrder must be conservative — given only a flat number[], it cannot
  // tell which keys are explicit `order` values vs. indexOf fallbacks that could climb
  // as high as `sortKeys.length` once the column regrows by one row (see the JSDoc on
  // appendOrder + the "survives the post-insertion indexOf shift" suite below for the
  // full explanation). That means the returned value is `max(maxFiniteKey,
  // sortKeys.length) + 1`, not simply `maxFiniteKey + 1` — several of the values below
  // moved up from the pre-#93-refetch-fix formula accordingly. Gaps in the numbering
  // are fine (see "sparse/drifted orders" below); only strict ordering matters.

  test("empty column starts just above the sentinel floor", () => {
    expect(appendOrder([])).toBe(1);
  });

  test("appends after a dense explicit ordering", () => {
    expect(appendOrder([0, 1, 2])).toBe(4);
  });

  test("appends after the max, not the count (sparse/drifted orders)", () => {
    expect(appendOrder([0, 7, 3])).toBe(8);
  });

  test("mixed explicit orders and indexOf fallbacks (the #93 scatter case)", () => {
    // Column of 4: three dragged cards carry order 0..2, one legacy card fell back to
    // its position (3). A new card must sort after ALL of them, AND after any implicit
    // sibling's indexOf once the column regrows to 5 rows.
    expect(appendOrder([0, 1, 2, 3])).toBe(5);
  });

  test("all-negative explicit orders still respect the post-insertion bound", () => {
    // Both keys are negative (so both are explicit — indexOf fallbacks are never
    // negative), but appendOrder can't see that; it stays conservative.
    expect(appendOrder([-5, -2])).toBe(3);
  });

  test("appends monotonically from negative keys", () => {
    const first = appendOrder([-3]);
    expect(first).toBeGreaterThanOrEqual(0);
    const second = appendOrder([-3, first]);
    expect(second).toBeGreaterThan(first);
  });

  test("ignores non-finite keys (defensive against `order: NaN` frontmatter)", () => {
    expect(appendOrder([Number.NaN, 2, Number.POSITIVE_INFINITY])).toBe(4);
  });

  test("consecutive appends stack in insertion order", () => {
    const keys = [0, 1];
    const a = appendOrder(keys);
    const b = appendOrder([...keys, a]);
    const c = appendOrder([...keys, a, b]);
    expect(a).toBeGreaterThan(Math.max(...keys));
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  describe("survives the post-insertion indexOf shift (#93 refetch scatter)", () => {
    // Models the real KanbanView flow: appendOrder is called over the column's
    // PRE-insertion effective keys, but the sort that actually places the new card
    // happens AFTER the SSE refetch rebuilds the column with n+1 rows. Cards without
    // an explicit `order` fall back to their indexOf in that GROWN column, so their
    // effective key can climb past what appendOrder saw. This test rebuilds the grown
    // column exactly like KanbanView's effOrder would and asserts the new card still
    // sorts last.
    function effOrderOf(explicitOrder: number | undefined, indexInGroup: number): number {
      return explicitOrder ?? indexInGroup;
    }

    test("two unordered legacy siblings — new card must sort after the indexOf shift", () => {
      // Pre-insertion column: Xray, Yellow (both implicit, effOrder = indexOf 0, 1).
      const preInsertionKeys = [0, 1];
      const newOrder = appendOrder(preInsertionKeys);

      // Post-insertion, the group is rebuilt alphabetically by filename: Apple gets
      // the new card's explicit order; Xray/Yellow fall back to their indexOf in the
      // GROWN (3-row) group.
      const grown = [
        { name: "Apple", order: newOrder as number | undefined },
        { name: "Xray", order: undefined as number | undefined },
        { name: "Yellow", order: undefined as number | undefined },
      ];
      const withKeys = grown.map((row, i) => ({
        name: row.name,
        key: effOrderOf(row.order, i),
      }));
      const sorted = [...withKeys].sort((a, b) => a.key - b.key);

      expect(sorted.at(-1)!.name).toBe("Apple");
    });

    test("single-card column — new card still sorts last", () => {
      const preInsertionKeys = [0]; // one legacy card, effOrder = indexOf 0
      const newOrder = appendOrder(preInsertionKeys);

      const grown = [
        { name: "Apple", order: newOrder as number | undefined },
        { name: "Zebra", order: undefined as number | undefined },
      ];
      const withKeys = grown.map((row, i) => ({
        name: row.name,
        key: effOrderOf(row.order, i),
      }));
      const sorted = [...withKeys].sort((a, b) => a.key - b.key);

      expect(sorted.at(-1)!.name).toBe("Apple");
    });

    test("all-explicit column — regression still passes (no implicit siblings to shift)", () => {
      const preInsertionKeys = [0, 1, 2]; // three dragged cards, all explicit orders
      const newOrder = appendOrder(preInsertionKeys);

      const grown = [
        { name: "Apple", order: newOrder as number | undefined },
        { name: "First", order: 0 },
        { name: "Second", order: 1 },
        { name: "Third", order: 2 },
      ];
      const withKeys = grown.map((row, i) => ({
        name: row.name,
        key: effOrderOf(row.order, i),
      }));
      const sorted = [...withKeys].sort((a, b) => a.key - b.key);

      expect(sorted.at(-1)!.name).toBe("Apple");
    });
  });
});
