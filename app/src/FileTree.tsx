// app/src/FileTree.tsx
import { createResource, createSignal, For, Show, onCleanup } from "solid-js";
import { api } from "./api";
import type { TreeEntry } from "../../core/src/graph";

/** Default sidebar icons; a note's `icon` frontmatter overrides the file icon (Obsidian-style). */
const FOLDER_ICON = "📁";
const FILE_ICON = "📝";

type TreeNode = { name: string; path: string; icon?: string; children?: Map<string, TreeNode> };

/** Turn flat entries ("a/b/c.md" + optional icon) into a nested folder tree. */
function buildTree(entries: TreeEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const { path, icon } of entries) {
    const parts = path.split("/");
    let cur = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (!cur.children!.has(part)) {
        cur.children!.set(part, { name: part, path: acc, children: isFile ? undefined : new Map() });
      }
      cur = cur.children!.get(part)!;
      if (isFile && icon) cur.icon = icon;
    });
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return [...(node.children?.values() ?? [])].sort((a, b) => {
    const af = !!a.children, bf = !!b.children;
    if (af !== bf) return af ? -1 : 1;          // folders before files
    return a.name.localeCompare(b.name);
  });
}

function Level(props: {
  node: TreeNode; depth: number;
  open: Set<string>; toggle: (p: string) => void; onOpen: (p: string) => void;
}) {
  return (
    <For each={sortedChildren(props.node)}>
      {(child) => {
        const indent = `${props.depth * 12 + 6}px`;
        return child.children ? (
          <div>
            <div
              style={{ padding: "2px 4px", "padding-left": indent, cursor: "pointer", opacity: 0.8, "user-select": "none" }}
              onClick={() => props.toggle(child.path)}
            >
              {props.open.has(child.path) ? "▾" : "▸"} {FOLDER_ICON} {child.name}
            </div>
            <Show when={props.open.has(child.path)}>
              <Level node={child} depth={props.depth + 1} open={props.open} toggle={props.toggle} onOpen={props.onOpen} />
            </Show>
          </div>
        ) : (
          <div
            style={{ padding: "2px 4px", "padding-left": indent, cursor: "pointer" }}
            onClick={() => props.onOpen(child.path)}
          >
            {child.icon ?? FILE_ICON} {child.name.replace(/\.md$/, "")}
          </div>
        );
      }}
    </For>
  );
}

export function FileTree(props: { onOpen: (path: string) => void }) {
  const [files, { refetch }] = createResource(() => api.tree());
  const t = setInterval(() => refetch(), 3000);
  onCleanup(() => clearInterval(t));

  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const toggle = (p: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  return (
    <div style={{ "font-size": "13px" }}>
      <Level node={buildTree(files() ?? [])} depth={0} open={open()} toggle={toggle} onOpen={props.onOpen} />
    </div>
  );
}
