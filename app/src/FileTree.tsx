// app/src/FileTree.tsx
import { createEffect, createResource, createSignal, For, Show, onCleanup } from "solid-js";
import { api } from "./api";
import { lastChange } from "./serverVersion";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { pushToast } from "./Toast";
import { renameEntries, removeEntries, addEntry } from "./fileTreeOps";
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

/** Parent dir and join path into a single namespace to reduce duplication. */
namespace Path {
  export function parent(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  export function join(dir: string, name: string): string {
    return dir ? `${dir}/${name}` : name;
  }
}

const parentOf = Path.parent;
const joinPath = Path.join;

export function FileTree(props: { onOpen: (path: string) => void }) {
  const [files, { refetch, mutate }] = createResource(() => api.tree());
  const [editing, setEditing] = createSignal<string | null>(null);
  const [dragPath, setDragPath] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  // React to server changes instead of blind polling.
  let lastSeen = 0;
  createEffect(() => {
    const c = lastChange();
    if (c.version === lastSeen) return;
    // Pause while the user is editing/dragging — rebuilding the tree tears down the
    // inline input or drag source. Don't advance lastSeen, so the change is picked
    // up once editing ends (this effect re-runs when editing()/dragPath() clear).
    if (editing() !== null || dragPath() !== null) return;
    lastSeen = c.version;
    // The server tells us whether a change altered tree structure or an icon. A
    // pure content edit (dirty.tree === false) leaves the tree as-is — no rescan.
    // Absent `dirty` (poll/reconnect) means "unknown", so refetch to be safe.
    if (c.dirty?.tree === false) return;
    refetch();
  });

  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const toggle = (p: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const refresh = () => refetch();

  // Optimistic local edits: apply the change to the tree instantly so the UI
  // reflects it without waiting for a /tree round-trip (which contends with the
  // server's graph rebuild). The op's own success path needs no refetch — the
  // optimistic state already matches the server; we only refresh() to *revert*
  // if the server call fails.
  const optimisticRename = (from: string, to: string) =>
    mutate((cur) => renameEntries(cur ?? [], from, to));
  const optimisticRemove = (path: string) =>
    mutate((cur) => removeEntries(cur ?? [], path));
  const optimisticAdd = (path: string, kind: "file" | "dir") =>
    mutate((cur) => addEntry(cur ?? [], path, kind));

  // LIFO stack of undoable deletes (most-recent first).
  const [undoStack, setUndoStack] = createSignal<{ trashPath: string; to: string; name: string }[]>([]);

  // Restore one trashed entry (drop it from the undo stack, move it back, refetch, toast).
  // Shared by the Cmd+Z handler and the delete toast's "Undo" button.
  async function restoreDeleted(entry: { trashPath: string; to: string; name: string }) {
    setUndoStack((s) => s.filter((u) => u.trashPath !== entry.trashPath));
    try {
      await api.restore(entry.trashPath, entry.to);
      await refresh();
      pushToast(`Restored ${entry.name}`);
    } catch (e) {
      pushToast(`Restore failed: ${(e as Error).message}`);
    }
  }

  function undoLastDelete() {
    const last = undoStack()[0];
    if (last) restoreDeleted(last);
  }

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoLastDelete();
    }
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  // Header "New note" / "New folder" buttons (in App.tsx) create at the vault root.
  const onNew = (e: Event) => {
    const kind = (e as CustomEvent).detail?.kind as "file" | "dir";
    if (kind === "file" || kind === "dir") doCreate("", kind);
  };
  window.addEventListener("oa-new", onNew);
  onCleanup(() => window.removeEventListener("oa-new", onNew));

  async function doDelete(node: TreeNode) {
    optimisticRemove(node.path); // instant; reverted via refresh() on failure
    // Close any open tab for the deleted file (or files under a deleted folder).
    window.dispatchEvent(new CustomEvent("oa-deleted", { detail: node.path }));
    try {
      const { trashPath } = await api.del(node.path);
      const entry = { trashPath, to: node.path, name: node.name };
      setUndoStack((s) => [entry, ...s]);
      pushToast(`Deleted ${node.name}`, { label: "Undo", onClick: () => restoreDeleted(entry) });
    } catch (e) {
      await refresh();
      pushToast(`Delete failed: ${(e as Error).message}`);
    }
  }

  async function doCreate(parentDir: string, kind: "file" | "dir") {
    const defaultName = kind === "dir" ? "New Folder" : "Untitled.md";
    const path = joinPath(parentDir, defaultName);
    optimisticAdd(path, kind); // instant; reverted via refresh() on failure
    if (parentDir) setOpen((prev) => new Set(prev).add(parentDir));
    setEditing(path);
    try {
      await api.create(path, kind);
    } catch (e) {
      setEditing(null);
      await refresh();
      pushToast(`Create failed: ${(e as Error).message}`);
    }
  }

  function buildMenuItems(node: TreeNode): MenuItem[] {
    const isDir = !!node.children;
    const items: MenuItem[] = [];
    if (isDir) {
      items.push({ label: "New File", onSelect: () => doCreate(node.path, "file") });
      items.push({ label: "New Folder", onSelect: () => doCreate(node.path, "dir") });
    }
    items.push({ label: "Rename", onSelect: () => setEditing(node.path) });
    items.push({ label: "Delete", danger: true, onSelect: () => doDelete(node) });
    return items;
  }

  function openMenuFor(node: TreeNode, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(node) });
  }

  /** Move the dragged node into `targetDir` ("" = vault root). Guards no-op and into-self. */
  async function moveInto(targetDir: string) {
    const from = dragPath();
    setDragPath(null);
    setDropTarget(null);
    if (from === null) return;
    if (parentOf(from) === targetDir) return; // already there
    if (targetDir === from || targetDir.startsWith(from + "/")) return; // into itself/descendant
    const to = joinPath(targetDir, from.split("/").pop()!);
    optimisticRename(from, to); // instant; reverted via refresh() on failure
    // Keep any open tab pointing at the moved path (incl. files under a moved folder).
    window.dispatchEvent(new CustomEvent("oa-moved", { detail: { from, to } }));
    if (targetDir) setOpen((prev) => new Set(prev).add(targetDir));
    try {
      await api.move(from, to);
    } catch (e) {
      await refresh();
      pushToast(`Move failed: ${(e as Error).message}`);
    }
  }

  const endDrag = () => {
    setDragPath(null);
    setDropTarget(null);
  };

  return (
    <div
      style={{ "font-size": "13px", "min-height": "100%" }}
      onDragOver={(e) => { e.preventDefault(); setDropTarget(""); }}
      onDrop={(e) => { e.preventDefault(); moveInto(""); }}
    >
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
        optimisticRename={optimisticRename}
        dragPath={dragPath()}
        setDragPath={setDragPath}
        dropTarget={dropTarget()}
        setDropTarget={setDropTarget}
        moveInto={moveInto}
        endDrag={endDrag}
      />
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}
      </Show>
    </div>
  );
}

/** Inline-editable name. Renders an auto-selected input; Enter commits via move, Escape cancels. */
function EditableLabel(props: {
  node: TreeNode; isDir: boolean; setEditing: (p: string | null) => void; refresh: () => void;
  optimisticRename: (from: string, to: string) => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  const initial = props.node.name;
  // setEditing(null) unmounts the input, which fires blur → a second commit.
  // `done` makes the rename (or cancel) run exactly once.
  let done = false;

  const commit = async () => {
    if (done) return;
    done = true;
    const raw = inputRef?.value.trim() ?? "";
    props.setEditing(null);
    if (!raw || raw === initial) return; // no-op
    // Preserve the .md extension for files if the user dropped it.
    const newName = !props.isDir && !raw.endsWith(".md") ? `${raw}.md` : raw;
    const from = props.node.path;
    const to = joinPath(parentOf(from), newName);
    props.optimisticRename(from, to); // instant; reverted via refresh() on failure
    // Keep any open tab pointing at the renamed path.
    window.dispatchEvent(new CustomEvent("oa-moved", { detail: { from, to } }));
    try {
      await api.move(from, to);
    } catch (e) {
      props.refresh();
      pushToast(`Rename failed: ${(e as Error).message}`);
    }
  };

  const cancel = () => {
    if (done) return;
    done = true;
    props.setEditing(null);
  };

  return (
    <input
      ref={(el) => {
        inputRef = el;
        // Select the editable stem (filename without .md) so typing replaces it.
        queueMicrotask(() => {
          el.focus();
          const dot = !props.isDir && el.value.endsWith(".md") ? el.value.length - 3 : -1;
          el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
        });
      }}
      value={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
      }}
      onBlur={commit}
      style={{
        font: "inherit",
        background: "var(--bg)",
        color: "var(--fg)",
        border: "1px solid var(--accent)",
        "border-radius": "3px",
        padding: "0 2px",
        width: "70%",
      }}
    />
  );
}

function Level(props: {
  node: TreeNode; depth: number;
  open: Set<string>; toggle: (p: string) => void; onOpen: (p: string) => void;
  onMenu: (node: TreeNode, e: MouseEvent) => void;
  editing: string | null; setEditing: (p: string | null) => void; refresh: () => void;
  optimisticRename: (from: string, to: string) => void;
  dragPath: string | null; setDragPath: (p: string | null) => void;
  dropTarget: string | null; setDropTarget: (p: string | null) => void;
  moveInto: (targetDir: string) => void; endDrag: () => void;
}) {
  return (
    <For each={sortedChildren(props.node)}>
      {(child) => {
        const indent = `${props.depth * 12 + 6}px`;
        return child.children ? (
          <div>
            <div
              style={{
                padding: "2px 4px", "padding-left": indent, cursor: "pointer", opacity: 0.8,
                "user-select": "none",
                background: props.dropTarget === child.path ? "var(--accent)" : "transparent",
              }}
              draggable={props.editing !== child.path}
              onDragStart={(e) => { e.stopPropagation(); props.setDragPath(child.path); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); props.setDropTarget(child.path); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); props.moveInto(child.path); }}
              onDragEnd={() => props.endDrag()}
              onClick={() => props.editing === child.path || props.toggle(child.path)}
              onDblClick={(e) => { e.stopPropagation(); props.setEditing(child.path); }}
              onContextMenu={(e) => props.onMenu(child, e)}
            >
              {props.open.has(child.path) ? "▾" : "▸"} {FOLDER_ICON}{" "}
              <Show when={props.editing === child.path} fallback={child.name}>
                <EditableLabel node={child} isDir={true} setEditing={props.setEditing} refresh={props.refresh} optimisticRename={props.optimisticRename} />
              </Show>
            </div>
            <Show when={props.open.has(child.path)}>
              <Level node={child} depth={props.depth + 1} open={props.open} toggle={props.toggle}
                onOpen={props.onOpen} onMenu={props.onMenu}
                editing={props.editing} setEditing={props.setEditing} refresh={props.refresh}
                optimisticRename={props.optimisticRename}
                dragPath={props.dragPath} setDragPath={props.setDragPath}
                dropTarget={props.dropTarget} setDropTarget={props.setDropTarget}
                moveInto={props.moveInto} endDrag={props.endDrag} />
            </Show>
          </div>
        ) : (
          <div
            style={{ padding: "2px 4px", "padding-left": indent, cursor: "pointer" }}
            draggable={props.editing !== child.path}
            onDragStart={(e) => {
              e.stopPropagation();
              props.setDragPath(child.path);
              // Expose the path so a pane can accept it as a drop-to-split (see PaneTree).
              e.dataTransfer?.setData("application/x-oa-path", child.path);
            }}
            onDragEnd={() => props.endDrag()}
            onClick={() => props.editing === child.path || props.onOpen(child.path)}
            onDblClick={(e) => { e.stopPropagation(); props.setEditing(child.path); }}
            onContextMenu={(e) => props.onMenu(child, e)}
          >
            {child.icon ?? FILE_ICON}{" "}
            <Show when={props.editing === child.path} fallback={child.name.replace(/\.md$/, "")}>
              <EditableLabel node={child} isDir={false} setEditing={props.setEditing} refresh={props.refresh} optimisticRename={props.optimisticRename} />
            </Show>
          </div>
        );
      }}
    </For>
  );
}
