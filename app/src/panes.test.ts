// app/src/panes.test.ts
import { test, expect } from "bun:test";
import {
  makeTab, makeLeaf, splitLeaf, closeLeaf, leaves,
  type Split, type Leaf,
} from "./panes";

test("makeTab produces a single-leaf tree focused on that leaf", () => {
  const tab = makeTab("a.md");
  expect(tab.root.kind).toBe("leaf");
  expect((tab.root as Leaf).content).toBe("a.md");
  expect(tab.focusId).toBe(tab.root.id);
});

test("splitLeaf replaces the leaf with a split whose two children share the content", () => {
  const root = makeLeaf("a.md");
  const { root: next, newLeafId } = splitLeaf(root, root.id, "row");
  expect(next.kind).toBe("split");
  const s = next as Split;
  expect(s.dir).toBe("row");
  expect(s.ratio).toBe(0.5);
  expect((s.a as Leaf).content).toBe("a.md");
  expect((s.b as Leaf).content).toBe("a.md");
  expect(s.b.id).toBe(newLeafId);
  expect(s.a.id).not.toBe(s.b.id);
});

test("splitLeaf only touches the targeted leaf in a nested tree", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row"); // a | a'
  const target = (r1 as Split).b.id;
  const { root: r2 } = splitLeaf(r1, target, "col");
  const s = r2 as Split;
  expect(s.a.kind).toBe("leaf");        // left side untouched
  expect(s.b.kind).toBe("split");       // right side became a col split
  expect((s.b as Split).dir).toBe("col");
});

test("closeLeaf collapses the parent split into the surviving sibling", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row"); // a | a'
  const s = r1 as Split;
  const next = closeLeaf(r1, s.b.id);
  expect(next).not.toBeNull();
  expect(next!.kind).toBe("leaf");
  expect((next as Leaf).id).toBe(s.a.id);
});

test("closeLeaf on the last remaining leaf returns null", () => {
  const root = makeLeaf("a.md");
  expect(closeLeaf(root, root.id)).toBeNull();
});

test("leaves lists every leaf left-to-right", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const ids = leaves(r1).map((l) => l.id);
  expect(ids.length).toBe(2);
  expect(ids).toContain((r1 as Split).a.id);
  expect(ids).toContain((r1 as Split).b.id);
});

import {
  equalize, setContent, findLeafByContent, leafCount,
} from "./panes";

test("leafCount counts leaves in a tree", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const { root: r2 } = splitLeaf(r1, (r1 as Split).b.id, "col");
  expect(leafCount(r2)).toBe(3);
});

test("equalize weights ratios by leaf count so all leaves get equal area", () => {
  // a | (b / c): left subtree has 1 leaf, right subtree has 2 leaves.
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const { root: r2 } = splitLeaf(r1, (r1 as Split).b.id, "col");
  const eq = equalize(r2) as Split;
  // top split should give 1/3 to the single leaf, 2/3 to the pair
  expect(eq.ratio).toBeCloseTo(1 / 3, 5);
  // the nested col split should be an even 1/2
  expect((eq.b as Split).ratio).toBeCloseTo(0.5, 5);
});

test("setContent retargets exactly one leaf", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const targetId = (r1 as Split).b.id;
  const next = setContent(r1, targetId, "b.md") as Split;
  expect((next.a as Leaf).content).toBe("a.md");
  expect((next.b as Leaf).content).toBe("b.md");
});

test("findLeafByContent returns the first leaf with matching content", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const found = findLeafByContent(r1, "a.md");
  expect(found).not.toBeNull();
  expect(found!.content).toBe("a.md");
  expect(findLeafByContent(r1, "missing.md")).toBeNull();
});
