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

test("equalize on a single leaf returns it unchanged", () => {
  const root = makeLeaf("a.md");
  expect(equalize(root)).toBe(root);
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

import { computeRects, focusNeighbor } from "./panes";

test("computeRects splits normalized space by ratio and direction", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row"); // ratio 0.5, side-by-side
  const s = r1 as Split;
  const rects = computeRects(r1);
  const a = rects.get(s.a.id)!;
  const b = rects.get(s.b.id)!;
  expect(a.x).toBeCloseTo(0, 5);
  expect(a.w).toBeCloseTo(0.5, 5);
  expect(b.x).toBeCloseTo(0.5, 5);
  expect(b.w).toBeCloseTo(0.5, 5);
  expect(a.h).toBeCloseTo(1, 5);
});

test("focusNeighbor finds the pane to the right", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row"); // a | b
  const s = r1 as Split;
  expect(focusNeighbor(r1, s.a.id, "right")).toBe(s.b.id);
  expect(focusNeighbor(r1, s.b.id, "left")).toBe(s.a.id);
  expect(focusNeighbor(r1, s.a.id, "up")).toBeNull(); // nothing above
});

test("focusNeighbor picks the straight-across pane in a 2x2 grid", () => {
  // Build row( col(A,B), col(C,D) ): A top-left, B bottom-left, C top-right, D bottom-right.
  const root = makeLeaf("A");
  const { root: r1 } = splitLeaf(root, root.id, "row"); // A | A'(right)
  const r2 = setContent(r1, (r1 as Split).b.id, "C"); // right side becomes C
  const left = splitLeaf(r2, (r2 as Split).a.id, "col"); // left: A / B
  const rightCol = splitLeaf(left.root, ((left.root as Split).b as Leaf).id, "col"); // right: C / D
  const tree = rightCol.root as Split;
  const leftSplit = tree.a as Split;
  const rightSplit = tree.b as Split;
  const A = leftSplit.a.id;
  const C = rightSplit.a.id; // top-right, straight across from A
  const D = rightSplit.b.id; // bottom-right, diagonal
  // From A pressing right must land on C (same row band), not the diagonal D.
  expect(focusNeighbor(tree, A, "right")).toBe(C);
  expect(focusNeighbor(tree, A, "right")).not.toBe(D);
  // And down from A is its column sibling B.
  expect(focusNeighbor(tree, A, "down")).toBe(leftSplit.b.id);
});

import { pruneMissing, serializeTabs, deserializeTabs } from "./panes";

test("pruneMissing drops leaves that no longer exist and collapses splits", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row"); // a | a'
  // rename one side so contents differ
  const s = r1 as Split;
  const r2 = setContent(r1, s.b.id, "gone.md");
  const pruned = pruneMissing(r2, (c) => c === "a.md");
  expect(pruned).not.toBeNull();
  expect(pruned!.kind).toBe("leaf");
  expect((pruned as Leaf).content).toBe("a.md");
});

test("pruneMissing returns null when nothing survives", () => {
  const root = makeLeaf("gone.md");
  expect(pruneMissing(root, () => false)).toBeNull();
});

test("pruneMissing collapses nested splits when an interior leaf is dropped", () => {
  // a | (b / c) — drop b, expect a | c (the inner col split collapses to c).
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const { root: r2 } = splitLeaf(r1, (r1 as Split).b.id, "col"); // right = (a' / a'')
  const inner = (r2 as Split).b as Split;
  const r3 = setContent(r2, inner.a.id, "b.md"); // b on top-right
  const r4 = setContent(r3, inner.b.id, "c.md"); // c on bottom-right
  const pruned = pruneMissing(r4, (x) => x !== "b.md") as Split;
  expect(pruned.kind).toBe("split");
  expect((pruned.a as Leaf).content).toBe("a.md");
  expect((pruned.b as Leaf).kind).toBe("leaf"); // inner split collapsed to a single leaf
  expect((pruned.b as Leaf).content).toBe("c.md");
});

test("serialize/deserialize round-trips tab content and active tab", () => {
  const tab = makeTab("a.md");
  const json = serializeTabs([tab], tab.id);
  const { tabs, activeTabId } = deserializeTabs(json, (c) => c === "a.md");
  expect(tabs.length).toBe(1);
  expect((tabs[0].root as Leaf).content).toBe("a.md");
  // Nodes are re-ided on load (see heal test), so the active tab is identified by the
  // restored tab's id, not the original.
  expect(activeTabId).toBe(tabs[0].id);
});

test("deserialize tolerates malformed JSON", () => {
  const { tabs, activeTabId } = deserializeTabs("not json{", () => true);
  expect(tabs).toEqual([]);
  expect(activeTabId).toBeNull();
});

test("deserialize drops a tab whose entire tree is missing and resets focus", () => {
  const tab = makeTab("gone.md");
  const json = serializeTabs([tab], tab.id);
  const { tabs } = deserializeTabs(json, () => false);
  expect(tabs).toEqual([]);
});

test("deserialize re-ids nodes so a layout with duplicate ids is healed", () => {
  // Simulates the counter-reset-across-reload bug: a persisted tree whose nodes share
  // ids. Without re-iding, splitLeaf/closeLeaf (which match by id) would hit every node
  // with that id — e.g. splitting one pane splits its twin too.
  const corrupt = JSON.stringify({
    tabs: [
      {
        id: "dup",
        focusId: "dup",
        root: {
          kind: "split",
          id: "dup",
          dir: "row",
          ratio: 0.5,
          a: { kind: "leaf", id: "dup", content: "a.md" },
          b: { kind: "leaf", id: "dup", content: "b.md" },
        },
      },
    ],
    activeTabId: "dup",
  });
  const { tabs, activeTabId } = deserializeTabs(corrupt, () => true);
  expect(tabs.length).toBe(1);
  const ids: string[] = [];
  const walk = (n: any) => {
    ids.push(n.id);
    if (n.kind === "split") {
      walk(n.a);
      walk(n.b);
    }
  };
  walk(tabs[0].root);
  expect(new Set(ids).size).toBe(ids.length); // every node id unique after heal
  expect(tabs[0].id).not.toBe(tabs[0].root.id); // tab id distinct from node ids
  // focusId resolves to a real leaf, and activeTabId to a real tab.
  expect(leaves(tabs[0].root).some((l) => l.id === tabs[0].focusId)).toBe(true);
  expect(activeTabId).toBe(tabs[0].id);
});

import { setRatio } from "./panes";

test("setRatio updates only the targeted split", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const s = r1 as Split;
  const next = setRatio(r1, s.id, 0.3) as Split;
  expect(next.ratio).toBeCloseTo(0.3, 5);
});
