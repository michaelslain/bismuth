// app/src/panes.dnd.test.ts
// Pure model ops backing the dynamic tab/pane drag system.
import { test, expect } from "bun:test";
import {
  makeTab, makeLeaf, splitLeaf, setContent, leaves,
  reorderTabs, splitLeafWithNode, detachLeafToTab, replacePaneWithPane,
  type Split, type Leaf, type Tab,
} from "./panes";

// --- reorderTabs ---------------------------------------------------------

function tabs3(): Tab[] {
  return [makeTab("A"), makeTab("B"), makeTab("C")];
}
const labels = (ts: Tab[]) => ts.map((t) => (t.root as Leaf).content);

test("reorderTabs moves the first tab to the end", () => {
  const ts = tabs3();
  // insertion index 3 = past C
  const out = reorderTabs(ts, ts[0].id, 3);
  expect(labels(out)).toEqual(["B", "C", "A"]);
});

test("reorderTabs moves the last tab to the front", () => {
  const ts = tabs3();
  const out = reorderTabs(ts, ts[2].id, 0);
  expect(labels(out)).toEqual(["C", "A", "B"]);
});

test("reorderTabs moves a middle tab between the others", () => {
  const ts = tabs3();
  // move A to insertion index 2 (between B and C) -> B A C
  const out = reorderTabs(ts, ts[0].id, 2);
  expect(labels(out)).toEqual(["B", "A", "C"]);
});

test("reorderTabs is a no-op when dropped within its own slot band", () => {
  const ts = tabs3();
  // dropping B just left (idx 1) or just right (idx 2) of itself = no move
  expect(labels(reorderTabs(ts, ts[1].id, 1))).toEqual(["A", "B", "C"]);
  expect(labels(reorderTabs(ts, ts[1].id, 2))).toEqual(["A", "B", "C"]);
});

test("reorderTabs returns the same array for an unknown id", () => {
  const ts = tabs3();
  expect(reorderTabs(ts, "nope", 0)).toBe(ts);
});

// --- splitLeafWithNode ---------------------------------------------------

test("splitLeafWithNode grafts a node on side b (nodeFirst=false)", () => {
  const root = makeLeaf("a.md");
  const node = makeLeaf("x.md");
  const { root: next } = splitLeafWithNode(root, root.id, "row", node, false);
  const s = next as Split;
  expect(s.kind).toBe("split");
  expect((s.a as Leaf).content).toBe("a.md");
  expect((s.b as Leaf).content).toBe("x.md");
  expect(s.b.id).toBe(node.id); // node kept its identity, not duplicated
});

test("splitLeafWithNode grafts a node on side a (nodeFirst=true)", () => {
  const root = makeLeaf("a.md");
  const node = makeLeaf("x.md");
  const { root: next } = splitLeafWithNode(root, root.id, "col", node, true);
  const s = next as Split;
  expect(s.dir).toBe("col");
  expect((s.a as Leaf).content).toBe("x.md");
  expect((s.b as Leaf).content).toBe("a.md");
});

test("splitLeafWithNode preserves a multi-pane subtree's internal layout", () => {
  // dragged tab is itself a split (b1 | b2); graft it whole into target a.
  const sub = splitLeaf(makeLeaf("b1.md"), "x", "row"); // won't match id; build manually instead
  const b = makeLeaf("b1.md");
  const subtree = splitLeaf(b, b.id, "col").root; // (b1 / b1)
  const subSplit = subtree as Split;
  const named = setContent(subtree, subSplit.b.id, "b2.md"); // (b1 / b2)
  const target = makeLeaf("a.md");
  const { root: next } = splitLeafWithNode(target, target.id, "row", named, false);
  const s = next as Split;
  expect((s.a as Leaf).content).toBe("a.md");
  expect(s.b.kind).toBe("split"); // subtree preserved, not flattened
  expect((s.b as Split).dir).toBe("col");
  expect(leaves(s.b).map((l) => l.content)).toEqual(["b1.md", "b2.md"]);
});

// --- detachLeafToTab -----------------------------------------------------

function splitTab(): Tab {
  // one tab containing (a.md | b.md)
  const t = makeTab("a.md");
  const { root, newLeafId } = splitLeaf(t.root, t.root.id, "row");
  const withB = setContent(root, newLeafId, "b.md");
  return { ...t, root: withB, focusId: (withB as Split).a.id };
}

test("detachLeafToTab pops a pane out as a new top-level tab at the index", () => {
  const src = splitTab();
  const bId = (src.root as Split).b.id;
  const tabs = [src, makeTab("Z")];
  const res = detachLeafToTab(tabs, src.id, bId, 0)!;
  expect(res).not.toBeNull();
  // new single-leaf tab inserted at front holding b.md
  expect((res.tabs[0].root as Leaf).content).toBe("b.md");
  expect(res.tabs[0].id).toBe(res.newTabId);
  expect(res.tabs[0].root.kind).toBe("leaf");
  // source tab survives, collapsed to just a.md
  const survivor = res.tabs.find((t) => t.id === src.id)!;
  expect(survivor.root.kind).toBe("leaf");
  expect((survivor.root as Leaf).content).toBe("a.md");
});

test("detachLeafToTab inserts at the end when toIndex is past the strip", () => {
  const src = splitTab();
  const bId = (src.root as Split).b.id;
  const tabs = [makeTab("Z"), src];
  const res = detachLeafToTab(tabs, src.id, bId, 2)!;
  expect((res.tabs[res.tabs.length - 1].root as Leaf).content).toBe("b.md");
});

test("detachLeafToTab resets the source focus when the detached pane was focused", () => {
  const src = splitTab();
  const bId = (src.root as Split).b.id;
  const focused: Tab = { ...src, focusId: bId }; // b is focused
  const res = detachLeafToTab([focused], focused.id, bId, 1)!;
  const survivor = res.tabs.find((t) => t.id === focused.id)!;
  // focus must point at a surviving leaf (a.md), not the detached one
  expect(leaves(survivor.root).some((l) => l.id === survivor.focusId)).toBe(true);
  expect(survivor.focusId).not.toBe(bId);
});

test("detachLeafToTab returns null for an unknown tab or leaf", () => {
  const src = splitTab();
  expect(detachLeafToTab([src], "nope", (src.root as Split).b.id, 0)).toBeNull();
  expect(detachLeafToTab([src], src.id, "nope", 0)).toBeNull();
});

// --- replacePaneWithPane (center-drop) -----------------------------------

test("replacePaneWithPane puts the source content into the target and closes the source", () => {
  const t = splitTab(); // (a.md | b.md)
  const aId = (t.root as Split).a.id;
  const bId = (t.root as Split).b.id;
  // drag a onto b's center -> b's pane now shows a.md; a's pane is gone -> collapses to single leaf
  const res = replacePaneWithPane(t.root, bId, aId)!;
  expect(res).not.toBeNull();
  expect(res.root.kind).toBe("leaf"); // split collapsed
  expect((res.root as Leaf).content).toBe("a.md");
  expect(res.root.id).toBe(bId); // target pane survived, holding source content
  expect(res.focusId).toBe(bId);
});

test("replacePaneWithPane is a no-op onto itself", () => {
  const t = splitTab();
  const aId = (t.root as Split).a.id;
  expect(replacePaneWithPane(t.root, aId, aId)).toBeNull();
});
