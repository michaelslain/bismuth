// app/src/panes.ts
// Pure model for per-tab pane layouts. A tab's content is a binary tree: a Leaf
// holds one content id (a note path or a ::sentinel), a Split divides space between
// two children. No DOM, no Solid — fully unit-testable.

export type Leaf = { kind: "leaf"; id: string; content: string };
export type Split = {
  kind: "split";
  id: string;
  dir: "row" | "col"; // row = side-by-side, col = stacked
  ratio: number; // fraction of space given to child `a` (0..1)
  a: PaneNode;
  b: PaneNode;
};
export type PaneNode = Leaf | Split;
// `name` is an optional user-set label that overrides the content-derived tab title
// (see contentLabel/tabBarLabel). Undefined = fall back to the automatic label.
export type Tab = { id: string; root: PaneNode; focusId: string; name?: string };

// Globally-unique ids. A counter would reset to 0 on page reload while persisted layouts
// keep their old ids — so a fresh split could mint an id that collides with an existing
// pane, and since ops match by id they'd hit both. crypto.randomUUID never repeats.
function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
}

export function makeLeaf(content: string): Leaf {
  return { kind: "leaf", id: newId(), content };
}

export function makeTab(content: string): Tab {
  const root = makeLeaf(content);
  return { id: newId(), root, focusId: root.id };
}

// Replace the target leaf with a split: original content on side `a`, and on side `b`
// either `newContent` (when provided) or a duplicate of the original. Returns the new
// root and the new leaf's id.
export function splitLeaf(
  root: PaneNode,
  leafId: string,
  dir: "row" | "col",
  newContent?: string,
): { root: PaneNode; newLeafId: string } {
  let newLeafId = "";
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") {
      if (node.id !== leafId) return node;
      const dup = makeLeaf(newContent ?? node.content);
      newLeafId = dup.id;
      return { kind: "split", id: newId(), dir, ratio: 0.5, a: node, b: dup };
    }
    return { ...node, a: walk(node.a), b: walk(node.b) };
  };
  return { root: walk(root), newLeafId };
}

// Remove the target leaf; its sibling takes the parent split's place. Returns the
// new root, or null when the tree becomes empty (closing the last pane).
export function closeLeaf(root: PaneNode, leafId: string): PaneNode | null {
  const walk = (node: PaneNode): PaneNode | null => {
    if (node.kind === "leaf") return node.id === leafId ? null : node;
    const a = walk(node.a);
    const b = walk(node.b);
    if (a === null) return b; // collapse to surviving sibling
    if (b === null) return a;
    if (a === node.a && b === node.b) return node;
    return { ...node, a, b };
  };
  return walk(root);
}

export function leaves(root: PaneNode): Leaf[] {
  return root.kind === "leaf" ? [root] : [...leaves(root.a), ...leaves(root.b)];
}

// After a tree was pruned/rebuilt, keep the old focus if its leaf survived, else fall
// back to the first surviving leaf. The single source of truth for the focus invariant.
export function resolveFocus(root: PaneNode, preferred: string): string {
  const ls = leaves(root);
  return ls.some((l) => l.id === preferred) ? preferred : ls[0].id;
}

export function leafCount(node: PaneNode): number {
  return node.kind === "leaf" ? 1 : leafCount(node.a) + leafCount(node.b);
}

// Recompute every split's ratio by leaf-count weighting so all leaves end up with
// equal area, even when nesting is uneven. Structure is unchanged.
export function equalize(root: PaneNode): PaneNode {
  if (root.kind === "leaf") return root;
  const a = equalize(root.a);
  const b = equalize(root.b);
  const ca = leafCount(a);
  const cb = leafCount(b);
  return { ...root, ratio: ca / (ca + cb), a, b };
}

export function setContent(root: PaneNode, leafId: string, content: string): PaneNode {
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") return node.id === leafId ? { ...node, content } : node;
    return { ...node, a: walk(node.a), b: walk(node.b) };
  };
  return walk(root);
}

export function findLeafByContent(root: PaneNode, content: string): Leaf | null {
  if (root.kind === "leaf") return root.content === content ? root : null;
  return findLeafByContent(root.a, content) ?? findLeafByContent(root.b, content);
}

// Move one pane next to another: remove the dragged leaf (collapsing its parent), then
// split the target along `dir` and place the dragged pane's content in the half nearest
// the drop. Returns the new root and the moved pane's id, or null if the move is a no-op
// (onto itself, dragged leaf missing, or dragging the tab's only pane).
export function movePane(
  root: PaneNode,
  draggedId: string,
  targetId: string,
  dir: Dir,
): { root: PaneNode; focusId: string } | null {
  if (draggedId === targetId) return null;
  const dragged = leaves(root).find((l) => l.id === draggedId);
  if (!dragged) return null;
  const afterClose = closeLeaf(root, draggedId);
  if (afterClose === null) return null; // can't move the only pane
  if (!leaves(afterClose).some((l) => l.id === targetId)) return null; // target gone (shouldn't happen)
  const splitDir = dir === "left" || dir === "right" ? "row" : "col";
  const { root: splitRoot, newLeafId } = splitLeaf(afterClose, targetId, splitDir);
  const moved = dir === "right" || dir === "down" ? newLeafId : targetId;
  return { root: setContent(splitRoot, moved, dragged.content), focusId: moved };
}

// Reorder a tab to a target insertion index (0..n, as produced by the drag
// controller from chip midpoints). The index is in the *original* array's
// coordinates; we adjust for the removal of the moved tab so dropping a tab
// just left or right of its own slot is a no-op. Unknown id → unchanged.
export function reorderTabs(tabs: Tab[], tabId: string, toIndex: number): Tab[] {
  const from = tabs.findIndex((t) => t.id === tabId);
  if (from === -1) return tabs;
  const adjusted = from < toIndex ? toIndex - 1 : toIndex;
  const clamped = Math.max(0, Math.min(adjusted, tabs.length - 1));
  if (clamped === from) return tabs;
  const next = tabs.slice();
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return next;
}

// Split the target leaf and graft an existing subtree `node` (a leaf or a whole
// split) into one half — `nodeFirst` puts it on side a (left/up), else side b
// (right/down). Unlike splitLeaf, `node` keeps its identity and internal layout,
// so a multi-pane tab dropped onto a pane preserves its structure.
export function splitLeafWithNode(
  root: PaneNode,
  targetId: string,
  dir: "row" | "col",
  node: PaneNode,
  nodeFirst: boolean,
): { root: PaneNode } {
  const walk = (n: PaneNode): PaneNode => {
    if (n.kind === "leaf") {
      if (n.id !== targetId) return n;
      const a = nodeFirst ? node : n;
      const b = nodeFirst ? n : node;
      return { kind: "split", id: newId(), dir, ratio: 0.5, a, b };
    }
    return { ...n, a: walk(n.a), b: walk(n.b) };
  };
  return { root: walk(root) };
}

// Replace the target leaf in place with `node` (a leaf or a whole subtree),
// keeping `node`'s identity/layout. Used when a multi-pane tab is dropped onto
// an empty pane or a pane's center — the pane *becomes* that layout rather than
// splitting beside it (which would orphan the old/empty leaf). Unchanged if the
// leaf id is absent.
export function replaceLeafWithNode(root: PaneNode, leafId: string, node: PaneNode): PaneNode {
  const walk = (n: PaneNode): PaneNode => {
    if (n.kind === "leaf") return n.id === leafId ? node : n;
    return { ...n, a: walk(n.a), b: walk(n.b) };
  };
  return walk(root);
}

// Center-drop: move the source pane's content into the target pane, then close
// the source (collapsing its split). Returns the new root + focus (the target),
// or null onto itself / missing panes / when the source is the only pane.
export function replacePaneWithPane(
  root: PaneNode,
  targetId: string,
  srcId: string,
): { root: PaneNode; focusId: string } | null {
  if (targetId === srcId) return null;
  const src = leaves(root).find((l) => l.id === srcId);
  if (!src) return null;
  if (!leaves(root).some((l) => l.id === targetId)) return null;
  const closed = closeLeaf(setContent(root, targetId, src.content), srcId);
  if (closed === null) return null;
  return { root: closed, focusId: targetId };
}

// Detach a pane (leaf) from its tab into a fresh top-level tab inserted at
// `toIndex`. The source tab keeps its remaining panes (its split collapses); a
// focus pointing at the detached pane is reset to a survivor. Returns null for
// an unknown tab/leaf or when the pane is its tab's only one (no split to leave).
export function detachLeafToTab(
  tabs: Tab[],
  srcTabId: string,
  leafId: string,
  toIndex: number,
): { tabs: Tab[]; newTabId: string } | null {
  const src = tabs.find((t) => t.id === srcTabId);
  if (!src) return null;
  const leaf = leaves(src.root).find((l) => l.id === leafId);
  if (!leaf) return null;
  const afterClose = closeLeaf(src.root, leafId);
  if (afterClose === null) return null;
  const ls = leaves(afterClose);
  const focusId = ls.some((l) => l.id === src.focusId) ? src.focusId : ls[0].id;
  const newTab = makeTab(leaf.content);
  const next = tabs.map((t) => (t.id === srcTabId ? { ...t, root: afterClose, focusId } : t));
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, newTab);
  return { tabs: next, newTabId: newTab.id };
}

import type { Rect } from "./dnd/geometry";
export type { Rect };
export type Dir = "left" | "right" | "up" | "down";

// Normalized layout rectangles (0..1) for every leaf, derived from split ratios.
export function computeRects(
  root: PaneNode,
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 },
): Map<string, Rect> {
  const map = new Map<string, Rect>();
  const walk = (node: PaneNode, r: Rect) => {
    if (node.kind === "leaf") {
      map.set(node.id, r);
      return;
    }
    if (node.dir === "row") {
      const wa = r.w * node.ratio;
      walk(node.a, { x: r.x, y: r.y, w: wa, h: r.h });
      walk(node.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h });
    } else {
      const ha = r.h * node.ratio;
      walk(node.a, { x: r.x, y: r.y, w: r.w, h: ha });
      walk(node.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha });
    }
  };
  walk(root, rect);
  return map;
}

// Nearest leaf whose center lies in the given direction from `fromId`.
export function focusNeighbor(root: PaneNode, fromId: string, dir: Dir): string | null {
  const rects = computeRects(root);
  const from = rects.get(fromId);
  if (!from) return null;
  const fcx = from.x + from.w / 2;
  const fcy = from.y + from.h / 2;
  const horizontal = dir === "left" || dir === "right";
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [id, r] of rects) {
    if (id === fromId) continue;
    const dx = r.x + r.w / 2 - fcx;
    const dy = r.y + r.h / 2 - fcy;

    // Check if neighbor is in the target direction
    let inDir: boolean;
    switch (dir) {
      case "right":
        inDir = dx > 0.001 && Math.abs(dy) <= Math.abs(dx);
        break;
      case "left":
        inDir = dx < -0.001 && Math.abs(dy) <= Math.abs(dx);
        break;
      case "down":
        inDir = dy > 0.001 && Math.abs(dx) <= Math.abs(dy);
        break;
      case "up":
        inDir = dy < -0.001 && Math.abs(dx) <= Math.abs(dy);
        break;
    }
    if (!inDir) continue;
    // Rank by distance along the travel axis first, breaking ties by the smaller
    // cross-axis offset — so "right" lands on the pane straight across, not a
    // diagonal one that merely happens to be closer in 2D.
    const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
    const score = primary * 1000 + secondary;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// Drop leaves for which exists(content) is false; collapse splits accordingly.
export function pruneMissing(
  root: PaneNode,
  exists: (content: string) => boolean,
): PaneNode | null {
  if (root.kind === "leaf") return exists(root.content) ? root : null;
  const a = pruneMissing(root.a, exists);
  const b = pruneMissing(root.b, exists);
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  if (a === root.a && b === root.b) return root;
  return { ...root, a, b };
}

export function setRatio(root: PaneNode, splitId: string, ratio: number): PaneNode {
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") return node;
    if (node.id === splitId) return { ...node, ratio };
    return { ...node, a: walk(node.a), b: walk(node.b) };
  };
  return walk(root);
}

type Persisted = { tabs: Tab[]; activeTabId: string | null };

export function serializeTabs(tabs: Tab[], activeTabId: string | null): string {
  const payload: Persisted = { tabs, activeTabId };
  return JSON.stringify(payload);
}

// Give every node a fresh unique id, recording old→new so references (focusId) can be
// remapped. Heals layouts persisted with duplicate ids (the counter-reset bug) and
// guarantees uniqueness regardless of what was stored.
function reassignIds(node: PaneNode, map: Map<string, string>): PaneNode {
  const id = newId();
  map.set(node.id, id);
  if (node.kind === "leaf") return { ...node, id };
  return { kind: "split", id, dir: node.dir, ratio: node.ratio, a: reassignIds(node.a, map), b: reassignIds(node.b, map) };
}

// Parse stored layout, pruning leaves whose content no longer exists, and re-id every
// node/tab so no two share an id. A tab whose whole tree is gone is dropped; a focusId
// pointing at a pruned leaf is reset to the tab's first surviving leaf. Malformed input
// yields an empty layout.
export function deserializeTabs(
  json: string | null,
  exists: (content: string) => boolean,
): Persisted {
  if (!json) return { tabs: [], activeTabId: null };
  let parsed: Persisted;
  try {
    parsed = JSON.parse(json) as Persisted;
  } catch {
    return { tabs: [], activeTabId: null };
  }
  if (!parsed || !Array.isArray(parsed.tabs)) return { tabs: [], activeTabId: null };
  const tabs: Tab[] = [];
  const tabIdMap = new Map<string, string>();
  for (const t of parsed.tabs) {
    const pruned = pruneMissing(t.root, exists);
    if (!pruned) continue;
    const idMap = new Map<string, string>();
    const root = reassignIds(pruned, idMap);
    const focusId = resolveFocus(root, idMap.get(t.focusId) ?? "");
    const tabId = newId();
    tabIdMap.set(t.id, tabId);
    // Preserve a user-set tab name across reloads; ignore non-string/blank values.
    const name = typeof t.name === "string" && t.name.trim() ? t.name : undefined;
    tabs.push({ id: tabId, root, focusId, name });
  }
  const activeTabId = tabIdMap.get(parsed.activeTabId ?? "") ?? tabs[0]?.id ?? null;
  return { tabs, activeTabId };
}
