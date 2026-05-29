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
export type Tab = { id: string; root: PaneNode; focusId: string };

// Globally-unique ids. A counter would reset to 0 on page reload while persisted layouts
// keep their old ids — so a fresh split could mint an id that collides with an existing
// pane, and since ops match by id they'd hit both. crypto.randomUUID never repeats.
function newId(): string {
  return crypto.randomUUID();
}

export function makeLeaf(content: string): Leaf {
  return { kind: "leaf", id: newId(), content };
}

export function makeTab(content: string): Tab {
  const root = makeLeaf(content);
  return { id: newId(), root, focusId: root.id };
}

// Replace the target leaf with a split: original content on side `a`, a duplicate
// on side `b`. Returns the new root and the new (duplicate) leaf's id.
export function splitLeaf(
  root: PaneNode,
  leafId: string,
  dir: "row" | "col",
): { root: PaneNode; newLeafId: string } {
  let newLeafId = "";
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") {
      if (node.id !== leafId) return node;
      const dup = makeLeaf(node.content);
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

export type Rect = { x: number; y: number; w: number; h: number };
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
    const inDir =
      dir === "right" ? dx > 0.001 && Math.abs(dy) <= Math.abs(dx) :
      dir === "left" ? dx < -0.001 && Math.abs(dy) <= Math.abs(dx) :
      dir === "down" ? dy > 0.001 && Math.abs(dx) <= Math.abs(dy) :
      /* up */ dy < -0.001 && Math.abs(dx) <= Math.abs(dy);
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
    const ls = leaves(root);
    const mappedFocus = idMap.get(t.focusId);
    const focusId = mappedFocus && ls.some((l) => l.id === mappedFocus) ? mappedFocus : ls[0].id;
    const tabId = newId();
    tabIdMap.set(t.id, tabId);
    tabs.push({ id: tabId, root, focusId });
  }
  const activeTabId = tabIdMap.get(parsed.activeTabId ?? "") ?? tabs[0]?.id ?? null;
  return { tabs, activeTabId };
}
