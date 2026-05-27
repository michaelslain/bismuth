// app/src/FileTree.tsx
import { createResource, createSignal, For, Show, onCleanup } from "solid-js";
import { api } from "./api";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { pushToast } from "./Toast";
import type { TreeEntry } from "../../core/src/graph";

const FOLDER_ICON = "📁";
const FILE_ICON = "📝";

type TreeNode = { name: string; path: string; icon?: string; children?: Map<string, TreeNode> };

function buildTree(entries: TreeEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const { path, icon, kind } of entries) {
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
      if (isLeaf && kind !== "dir" && icon) node.icon = icon;
      cur = node;
    });
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return [...(node.children?.values() ?? [])].sort((a, b) => {
    const af = !!a.children, bf = !!b.children;
    if (af !== bf) return af ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Join a parent dir and a name into a vault path. */
function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
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

  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);

  const refresh = () => refetch();

  async function doDelete(node: TreeNode) {
    try {
      const { trashPath } = await api.del(node.path);
      await refresh();
      pushToast(`Deleted ${node.name}`, {
        label: "Undo",
        onClick: async () => {
          try {
            await api.restore(trashPath, node.path);
            await refresh();
            pushToast(`Restored ${node.name}`);
          } catch (e) {
            pushToast(`Restore failed: ${(e as Error).message}`);
          }
        },
      });
    } catch (e) {
      pushToast(`Delete failed: ${(e as Error).message}`);
    }
  }

  async function doCreate(parentDir: string, kind: "file" | "dir") {
    const defaultName = kind === "dir" ? "New Folder" : "Untitled.md";
    const path = joinPath(parentDir, defaultName);
    try {
      await api.create(path, kind);
      if (parentDir) setOpen((prev) => new Set(prev).add(parentDir));
      await refresh();
      setEditing(path);
    } catch (e) {
      pushToast(`Create failed: ${(e as Error).message}`);
    }
  }

  function openMenuFor(node: TreeNode, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const isDir = !!node.children;
    const items: MenuItem[] = [];
    if (isDir) {
      items.push({ label: "New File", onSelect: () => doCreate(node.path, "file") });
      items.push({ label: "New Folder", onSelect: () => doCreate(node.path, "dir") });
    }
    items.push({ label: "Rename", onSelect: () => setEditing(node.path) });
    items.push({ label: "Delete", danger: true, onSelect: () => doDelete(node) });
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <div style={{ "font-size": "13px" }}>
      <Level
        node={buildTree(files() ?? [])}
        depth={0}
        open={open()}
        toggle={toggle}
        onOpen={props.onOpen}
        onMenu={openMenuFor}
        editing={editing()}
        setEditing={setEditing}
        refresh={refresh}
      />
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}
      </Show>
    </div>
  );
}

function Level(props: {
  node: TreeNode; depth: number;
  open: Set<string>; toggle: (p: string) => void; onOpen: (p: string) => void;
  onMenu: (node: TreeNode, e: MouseEvent) => void;
  editing: string | null; setEditing: (p: string | null) => void; refresh: () => void;
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
              onContextMenu={(e) => props.onMenu(child, e)}
            >
              {props.open.has(child.path) ? "▾" : "▸"} {FOLDER_ICON} {child.name}
            </div>
            <Show when={props.open.has(child.path)}>
              <Level node={child} depth={props.depth + 1} open={props.open} toggle={props.toggle}
                onOpen={props.onOpen} onMenu={props.onMenu}
                editing={props.editing} setEditing={props.setEditing} refresh={props.refresh} />
            </Show>
          </div>
        ) : (
          <div
            style={{ padding: "2px 4px", "padding-left": indent, cursor: "pointer" }}
            onClick={() => props.onOpen(child.path)}
            onContextMenu={(e) => props.onMenu(child, e)}
          >
            {child.icon ?? FILE_ICON} {child.name.replace(/\.md$/, "")}
          </div>
        );
      }}
    </For>
  );
}
