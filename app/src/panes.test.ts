// app/src/panes.test.ts
import { test, expect } from "bun:test";
import {
  makeTab, makeLeaf, splitLeaf, closeLeaf, leaves,
  type Split, type Leaf, type PaneNode,
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

// Regression: equal AREAS must not depend on split ORDER. The user reported
// "split horizontal->vertical equalizes but split vertical->horizontal doesn't".
// computeRects(equalize(x)) should give every leaf the same w*h regardless of nesting.
function areas(root: PaneNode): number[] {
  const rects = computeRects(root);
  return leaves(root).map((l) => {
    const r = rects.get(l.id)!;
    return r.w * r.h;
  });
}

test("equalize gives equal areas: row first, then col on the right child", () => {
  // a | (b / c) — outer row, inner col on the right.
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const { root: r2 } = splitLeaf(r1, (r1 as Split).b.id, "col");
  const eq = equalize(r2);
  const out = areas(eq);
  expect(out.length).toBe(3);
  for (const a of out) expect(a).toBeCloseTo(1 / 3, 5);
});

test("equalize gives equal areas: col first, then row on the bottom child", () => {
  // a / (b | c) — outer col, inner row on the bottom. Mirror of the case above.
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "col");
  const { root: r2 } = splitLeaf(r1, (r1 as Split).b.id, "row");
  const eq = equalize(r2);
  const out = areas(eq);
  expect(out.length).toBe(3);
  for (const a of out) expect(a).toBeCloseTo(1 / 3, 5);
});

test("equalize equal areas are independent of split order (row->col == col->row)", () => {
  // Build both nesting orders and assert each leaf ends up with exactly 1/3 area,
  // proving area-equality does not depend on whether the row or the col was first.
  const rowFirstBase = makeLeaf("a.md");
  const { root: rf1 } = splitLeaf(rowFirstBase, rowFirstBase.id, "row");
  const { root: rf2 } = splitLeaf(rf1, (rf1 as Split).b.id, "col");

  const colFirstBase = makeLeaf("a.md");
  const { root: cf1 } = splitLeaf(colFirstBase, colFirstBase.id, "col");
  const { root: cf2 } = splitLeaf(cf1, (cf1 as Split).b.id, "row");

  const rowFirst = areas(equalize(rf2)).sort();
  const colFirst = areas(equalize(cf2)).sort();
  expect(rowFirst.length).toBe(3);
  expect(colFirst.length).toBe(3);
  for (let i = 0; i < 3; i++) {
    expect(rowFirst[i]).toBeCloseTo(1 / 3, 5);
    expect(colFirst[i]).toBeCloseTo(1 / 3, 5);
    expect(rowFirst[i]).toBeCloseTo(colFirst[i], 5);
  }
});

test("equalize is idempotent: equalize(equalize(x)) keeps equal areas", () => {
  // Lopsided 4-leaf tree: a | (b / (c | d)).
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const { root: r2 } = splitLeaf(r1, (r1 as Split).b.id, "col");
  const { root: r3 } = splitLeaf(r2, ((r2 as Split).b as Split).b.id, "row");
  const once = equalize(r3);
  const twice = equalize(once);
  const a1 = areas(once);
  const a2 = areas(twice);
  expect(a1.length).toBe(4);
  expect(a2.length).toBe(4);
  for (const a of a1) expect(a).toBeCloseTo(1 / 4, 5);
  for (const a of a2) expect(a).toBeCloseTo(1 / 4, 5);
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

import { movePane } from "./panes";

test("movePane reorders two side-by-side panes when dropped on the far edge", () => {
  // row(a | b); drag a onto b's RIGHT edge -> b ends up left, a right.
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const s = r1 as Split;
  const r2 = setContent(r1, s.b.id, "b.md"); // a | b
  const aId = (r2 as Split).a.id;
  const bId = (r2 as Split).b.id;
  const res = movePane(r2, aId, bId, "right")!;
  expect(res).not.toBeNull();
  const out = res.root as Split;
  expect(out.kind).toBe("split");
  expect((out.a as Leaf).content).toBe("b.md"); // b moved to the left
  expect((out.b as Leaf).content).toBe("a.md"); // a dropped on the right
  expect(res.focusId).toBe(out.b.id); // moved pane is focused
});

test("movePane changes split direction when dropped on a perpendicular edge", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const s = r1 as Split;
  const r2 = setContent(r1, s.b.id, "b.md"); // a | b
  // drop a onto b's BOTTOM edge -> a stacked under b (col split).
  const out = movePane(r2, (r2 as Split).a.id, (r2 as Split).b.id, "down")!.root as Split;
  expect(out.dir).toBe("col");
  expect((out.a as Leaf).content).toBe("b.md");
  expect((out.b as Leaf).content).toBe("a.md");
});

test("movePane is a no-op onto itself or for the only pane", () => {
  const root = makeLeaf("a.md");
  expect(movePane(root, root.id, root.id, "right")).toBeNull(); // onto itself
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const s = r1 as Split;
  expect(movePane(r1, s.a.id, s.a.id, "left")).toBeNull(); // onto itself
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

test("reopen round-trip preserves a chat tab's ::chat: content id (BUG #66 resume anchor)", () => {
  // Cmd+Shift+T revives a closed tab via serialize→deserialize. The chat's ::chat:<uuid> content id
  // is what ChatView.props.chatId keys recallChatSession() on to RESUME the conversation, so it MUST
  // survive the round-trip byte-for-byte — a re-id or migration of it would silently reopen a blank
  // chat instead of the prior conversation. Guards the row-66 regression.
  const chatContent = "::chat:11111111-2222-3333-4444-555555555555";
  const tab = makeTab(chatContent);
  const { tabs } = deserializeTabs(serializeTabs([tab], tab.id), () => true);
  expect(tabs.length).toBe(1);
  expect((tabs[0].root as Leaf).content).toBe(chatContent);
});

test("reopen round-trip preserves a user-set tab name (FEATURE #75 chat rename persistence)", () => {
  const tab = { ...makeTab("::chat:abc"), name: "My Secret Chat" };
  const { tabs } = deserializeTabs(serializeTabs([tab], tab.id), () => true);
  expect(tabs[0].name).toBe("My Secret Chat");
  expect((tabs[0].root as Leaf).content).toBe("::chat:abc");
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

import { migrateLegacyContent, LEGACY_CONTENT_IDS } from "./panes";

// #8 (unified search): the ::search tab was removed — search IS the Cmd+O switcher now. A layout
// persisted by an older build may still hold a ::search leaf; restore must migrate it to a graph
// home tab rather than crash or route it to a removed view.
test("deserialize migrates a persisted ::search tab to ::graph (the Search tab is gone)", () => {
  const tab = makeTab("::search");
  const json = serializeTabs([tab], tab.id);
  const { tabs, activeTabId } = deserializeTabs(json, () => true);
  expect(tabs.length).toBe(1);
  expect((tabs[0].root as Leaf).content).toBe("::graph");
  expect(activeTabId).toBe(tabs[0].id);
});

test("deserialize migrates a ::search leaf inside a split, leaving its sibling untouched", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const r2 = setContent(r1, (r1 as Split).b.id, "::search");
  const tab = { ...makeTab("x"), root: r2, focusId: (r2 as Split).a.id };
  const { tabs } = deserializeTabs(serializeTabs([tab], tab.id), () => true);
  const restored = tabs[0].root as Split;
  expect((restored.a as Leaf).content).toBe("a.md");
  expect((restored.b as Leaf).content).toBe("::graph");
});

test("migrateLegacyContent returns the SAME node when nothing needs rewriting", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  expect(migrateLegacyContent(r1)).toBe(r1); // identity — no churn on modern layouts
  expect(Object.keys(LEGACY_CONTENT_IDS)).toContain("::search");
});

import { setRatio } from "./panes";

test("setRatio updates only the targeted split", () => {
  const root = makeLeaf("a.md");
  const { root: r1 } = splitLeaf(root, root.id, "row");
  const s = r1 as Split;
  const next = setRatio(r1, s.id, 0.3) as Split;
  expect(next.ratio).toBeCloseTo(0.3, 5);
});

test("splitLeaf with newContent puts that content in the new leaf, original in the kept side", () => {
  const root = makeLeaf("a.md");
  const { root: next, newLeafId } = splitLeaf(root, root.id, "row", "::empty");
  const s = next as Split;
  expect((s.a as Leaf).content).toBe("a.md");
  expect((s.b as Leaf).content).toBe("::empty");
  expect(s.b.id).toBe(newLeafId);
});

test("splitLeaf without newContent still duplicates (backwards compat)", () => {
  const root = makeLeaf("a.md");
  const { root: next } = splitLeaf(root, root.id, "row");
  const s = next as Split;
  expect((s.a as Leaf).content).toBe("a.md");
  expect((s.b as Leaf).content).toBe("a.md");
});

// --- Pinned tabs ---
import { sortPinned, setTabPinned, reorderTabs, splitColdLaunch, type Tab } from "./panes";

// Build a list of single-leaf tabs by content, marking the given contents as pinned.
function tabsFrom(contents: string[], pinned: string[] = []): Tab[] {
  const set = new Set(pinned);
  return contents.map((c) => {
    const t = makeTab(c);
    return set.has(c) ? { ...t, pinned: true } : t;
  });
}
const contentsOf = (tabs: Tab[]): string[] =>
  tabs.map((t) => (t.root as Leaf).content);

test("sortPinned moves pinned tabs before unpinned, preserving each group's order", () => {
  const tabs = tabsFrom(["a", "b", "c", "d"], ["b", "d"]);
  const sorted = sortPinned(tabs);
  // pinned b,d (in original relative order) then unpinned a,c (in original relative order)
  expect(contentsOf(sorted)).toEqual(["b", "d", "a", "c"]);
});

test("sortPinned returns the SAME array when already partitioned (no signal churn)", () => {
  const already = tabsFrom(["p", "q", "x", "y"], ["p", "q"]);
  expect(sortPinned(already)).toBe(already);
  // All-unpinned and all-pinned are trivially partitioned too.
  const none = tabsFrom(["x", "y"]);
  expect(sortPinned(none)).toBe(none);
  const all = tabsFrom(["p", "q"], ["p", "q"]);
  expect(sortPinned(all)).toBe(all);
});

test("setTabPinned pins a tab and floats it to the end of the pinned block", () => {
  const tabs = tabsFrom(["a", "b", "c"]); // none pinned
  const next = setTabPinned(tabs, tabs[2].id, true); // pin "c"
  expect(contentsOf(next)).toEqual(["c", "a", "b"]);
  expect(next.find((t) => (t.root as Leaf).content === "c")!.pinned).toBe(true);
});

test("setTabPinned unpinning re-sorts the tab behind the remaining pinned block", () => {
  const tabs = tabsFrom(["a", "b", "c"], ["a", "b"]); // [a*, b*, c]
  const next = setTabPinned(tabs, tabs[0].id, false); // unpin "a"
  // a is now unpinned → after pinned b; original unpinned order (c) preserved
  expect(contentsOf(next)).toEqual(["b", "a", "c"]);
  expect(next.find((t) => (t.root as Leaf).content === "a")!.pinned).toBeUndefined();
});

test("setTabPinned on an unknown id returns the same array", () => {
  const tabs = tabsFrom(["a", "b"]);
  expect(setTabPinned(tabs, "nope", true)).toBe(tabs);
});

test("reorderTabs cannot drag an unpinned tab in front of a pinned one", () => {
  const tabs = tabsFrom(["p", "a", "b"], ["p"]); // [p*, a, b]
  // Try to drop "b" at index 0 (before the pinned p); the partition clamps it back.
  const next = reorderTabs(tabs, tabs[2].id, 0);
  expect(contentsOf(next)).toEqual(["p", "b", "a"]); // p stays first; b reordered among unpinned
  expect(next[0].pinned).toBe(true);
});

test("reorderTabs still reorders freely within the unpinned group", () => {
  const tabs = tabsFrom(["p", "a", "b", "c"], ["p"]); // [p*, a, b, c]
  const next = reorderTabs(tabs, tabs[1].id, 4); // move "a" to the end
  expect(contentsOf(next)).toEqual(["p", "b", "c", "a"]);
});

test("serialize/deserialize round-trips the pinned flag", () => {
  const tabs = tabsFrom(["a", "b"], ["b"]);
  const json = serializeTabs(tabs, tabs[0].id);
  const { tabs: out } = deserializeTabs(json, () => true);
  // pinned "b" leads after the round-trip; its flag survives.
  expect(contentsOf(out)).toEqual(["b", "a"]);
  expect(out.find((t) => (t.root as Leaf).content === "b")!.pinned).toBe(true);
  expect(out.find((t) => (t.root as Leaf).content === "a")!.pinned).toBeUndefined();
});

test("deserialize normalizes a stored order where a pinned tab trails an unpinned one", () => {
  // Persisted (hand-built) with the pinned tab AFTER an unpinned one — deserialize sorts it front.
  const json = JSON.stringify({
    tabs: [
      { id: "u", focusId: "u", root: { kind: "leaf", id: "u", content: "a" } },
      { id: "p", focusId: "p", pinned: true, root: { kind: "leaf", id: "p", content: "b" } },
    ],
    activeTabId: "u",
  });
  const { tabs: out } = deserializeTabs(json, () => true);
  expect(contentsOf(out)).toEqual(["b", "a"]); // pinned "b" pulled to the front
  expect(out[0].pinned).toBe(true);
});

// --- Cold-launch restore (App.tsx startup): pinned tabs survive a full close+open ---

test("cold launch: a pinned tab is restored (still pinned + first), unpinned ones stashed", () => {
  // The full persistence path a real restart exercises: serialize the live tabs, then deserialize
  // the stored blob (as startup does), then split for a cold launch.
  const tabs = tabsFrom(["a", "b", "c"], ["b"]); // b pinned
  const layout = deserializeTabs(serializeTabs(tabs, tabs[0].id), () => true);
  const { restore, stash } = splitColdLaunch(layout);
  // The pinned tab auto-restores, pinned flag intact and sorted to the front.
  expect(contentsOf(restore.tabs)).toEqual(["b"]);
  expect(restore.tabs[0].pinned).toBe(true);
  // The unpinned remainder is handed back to stash (for Cmd+Shift+T), NOT dropped.
  expect(contentsOf(stash)).toEqual(["a", "c"]);
});

test("cold launch: active follows the pinned tab when it was active, else the first pinned", () => {
  const tabs = tabsFrom(["a", "b"], ["b"]);
  // Active = the pinned "b" → restored active stays "b".
  const bId = tabs.find((t) => (t.root as Leaf).content === "b")!.id;
  const l1 = deserializeTabs(serializeTabs(tabs, bId), () => true);
  const r1 = splitColdLaunch(l1);
  expect(r1.restore.activeTabId).toBe(r1.restore.tabs[0].id);
  // Active = an unpinned "a" (which won't be restored) → falls back to the first pinned tab.
  const aId = tabs.find((t) => (t.root as Leaf).content === "a")!.id;
  const l2 = deserializeTabs(serializeTabs(tabs, aId), () => true);
  const r2 = splitColdLaunch(l2);
  expect(r2.restore.activeTabId).toBe(r2.restore.tabs[0].id);
});

test("cold launch with no pinned tabs restores nothing and stashes the whole session", () => {
  const tabs = tabsFrom(["a", "b"]); // none pinned
  const layout = deserializeTabs(serializeTabs(tabs, tabs[0].id), () => true);
  const { restore, stash } = splitColdLaunch(layout);
  expect(restore.tabs).toEqual([]);
  expect(restore.activeTabId).toBeNull();
  expect(contentsOf(stash)).toEqual(["a", "b"]);
});

// --- #56: opening a note always opens a new tab (never replaces the active one) ---
import { decideOpen } from "./panes";

test("decideOpen: no-op when the active tab's focused pane already shows the content", () => {
  const [active] = tabsFrom(["a"]);
  expect(decideOpen([active], active, "a")).toEqual({ kind: "noop" });
});

test("decideOpen: new tab when there is no active tab at all", () => {
  const [other] = tabsFrom(["a"]);
  expect(decideOpen([other], null, "b")).toEqual({ kind: "new" });
});

test("decideOpen: new tab when the content isn't open anywhere, even on a pinned active tab", () => {
  const [pinned] = tabsFrom(["a"], ["a"]);
  expect(decideOpen([pinned], pinned, "b")).toEqual({ kind: "new" });
});

test("decideOpen: focuses the existing tab when the content is already open elsewhere", () => {
  const [a, b] = tabsFrom(["a", "b"]);
  // Active tab is "a", but "b" is already open in another tab — focus it, don't duplicate.
  const decision = decideOpen([a, b], a, "b");
  expect(decision).toEqual({ kind: "focus", tabId: b.id, leafId: (b.root as Leaf).id });
});

test("decideOpen: focuses another pane of the ACTIVE tab when it already shows the content", () => {
  const root = makeLeaf("a.md");
  const { root: split, newLeafId } = splitLeaf(root, root.id, "row", "b.md"); // a.md | b.md
  const active: Tab = { id: "t1", root: split, focusId: root.id }; // focused on the a.md pane
  const decision = decideOpen([active], active, "b.md");
  expect(decision).toEqual({ kind: "focus", tabId: "t1", leafId: newLeafId });
});

test("decideOpen: new tab (not in-place) when a normal, unpinned active tab shows something else", () => {
  const [normal] = tabsFrom(["a"]);
  expect(decideOpen([normal], normal, "b")).toEqual({ kind: "new" });
});

