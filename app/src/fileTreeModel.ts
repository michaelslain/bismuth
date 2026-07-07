// app/src/fileTreeModel.ts
// Pure tree-building + reconciliation for the sidebar file tree. Lives in its own module
// (like fileTreeRefresh.ts) so it can be unit-tested headlessly without importing the
// component tree (lucide-solid, CodeMirror, …).
import type { TreeEntry } from "../../core/src/graph";

export type TreeNode = {
  name: string;
  path: string;
  icon?: string;
  label?: string;
  isSystemFolder?: boolean;
  /** RESOLVED AI visibility (core/src/visibility.ts), omitted for "all" — see TreeEntry. */
  visibility?: "chat-only" | "hidden";
  /** The node's OWN explicit setting (unresolved) — see TreeEntry.ownVisibility. Used by
   *  the context menu to checkmark the active row and name the ancestor forcing a
   *  stricter effective value, when one applies. */
  ownVisibility?: "chat-only" | "hidden";
  children?: Map<string, TreeNode>;
};

export function buildTree(entries: TreeEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const { path, icon, kind, isSystemFolder, label, visibility, ownVisibility } of entries) {
    const parts = path.split("/");
    let cur = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      const isDir = isLeaf ? kind === "dir" : true;
      if (!cur.children!.has(part)) {
        cur.children!.set(part, { name: part, path: acc, children: isDir ? new Map() : undefined });
      }
      const node = cur.children!.get(part)!;
      // Custom icon for the entry's own node — files (frontmatter `icon`) and
      // folders (folder-icon override surfaced on dir entries) alike.
      if (isLeaf && icon) node.icon = icon;
      // System folders (.settings / .daemon): rendered distinctly, label override
      // (e.g. .daemon shows the configured daemon name), guarded from rename/delete.
      if (isLeaf && isSystemFolder) node.isSystemFolder = true;
      if (isLeaf && label) node.label = label;
      if (isLeaf && visibility && visibility !== "all") node.visibility = visibility;
      if (isLeaf && ownVisibility) node.ownVisibility = ownVisibility;
      cur = node;
    });
  }
  return root;
}

/**
 * Persistent-identity reconciliation: walk the freshly-built tree against the previous one and
 * reuse the OLD node object wherever a node's own fields AND its entire subtree are unchanged.
 *
 * Why the "entire subtree" bar is load-bearing: `<Level node={child}>` binds its node as a static
 * closure constant — Solid's `<For>` passes plain non-reactive values — so a nested level only ever
 * updates by being REMOUNTED, which happens exactly when its parent's `<For>` sees a changed child
 * reference. Reusing a folder's reference while something beneath it changed would make that change
 * invisible (deleted files still shown, new files never appearing). So ANY descendant difference —
 * add, removal, rename, file↔dir flip, icon/label/system-flag change — busts every reference on the
 * spine up to the root, while untouched sibling subtrees keep identity and their rows (DOM, open
 * state, handlers) survive the rebuild instead of being disposed + recreated.
 *
 * Field comparison is exhaustive over everything buildTree sets (name/path/icon/label/
 * isSystemFolder/visibility/ownVisibility/dir-ness): `next` is always a fresh build
 * reflecting current truth, so a cleared icon, label, or visibility shows up as a field
 * difference here (never a stale carried-over value).
 */
export function reconcileTree(prev: TreeNode | undefined, next: TreeNode): TreeNode {
  if (!prev) return next;
  const sameFields =
    prev.name === next.name &&
    prev.path === next.path &&
    prev.icon === next.icon &&
    prev.label === next.label &&
    prev.isSystemFolder === next.isSystemFolder &&
    prev.visibility === next.visibility &&
    prev.ownVisibility === next.ownVisibility &&
    !prev.children === !next.children; // file ↔ dir flip at the same path
  if (!next.children || !prev.children) return sameFields && !next.children && !prev.children ? prev : next;
  // Size mismatch catches pure removals; an equal-size add+remove swap is caught below because
  // the added key has no old counterpart (rec !== old with old === undefined).
  let allSame = sameFields && prev.children.size === next.children.size;
  for (const [key, child] of next.children) {
    const old = prev.children.get(key);
    const rec = old ? reconcileTree(old, child) : child;
    if (rec !== old) allSame = false;
    if (rec !== child) next.children.set(key, rec);
  }
  return allSame ? prev : next;
}
