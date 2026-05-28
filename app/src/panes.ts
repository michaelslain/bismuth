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

let _counter = 0;
function newId(): string {
  return `pane-${++_counter}`;
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
