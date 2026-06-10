// app/src/FileTree.tsx
import { createEffect, createResource, createSignal, For, Show, onCleanup, type JSX } from "solid-js";
import { api } from "./api";
import { readCache, writeCache } from "./viewCache";
import { lastChange } from "./serverVersion";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { openContextMenu } from "./nativeMenu";
import { pushToast } from "./Toast";
import { renameEntries, removeEntries, addEntry } from "./fileTreeOps";
import type { TreeEntry } from "../../core/src/graph";
import { Icon } from "./icons/Icon";
import { IconPicker } from "./icons/IconPicker";

type TreeNode = { name: string; path: string; icon?: string; children?: Map<string, TreeNode> };

// Extensions hidden in the tree's display labels (and re-applied on rename),
// just like Obsidian hides `.md`. Markdown notes and YAML configs alike.
const STRIP_EXT = /\.(md|yaml|yml)$/i;
const displayName = (name: string) => name.replace(STRIP_EXT, "");

const TREE_CACHE_KEY = "oa-tree-cache-v1";

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
      // Custom icon for the entry's own node — files (frontmatter `icon`) and
      // folders (folder-icon override surfaced on dir entries) alike.
      if (isLeaf && icon) node.icon = icon;
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

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

// Pure SSE-refresh decision logic lives in its own module so it can be unit-tested
// headlessly without importing this component tree (lucide-solid, CodeMirror, …). Import
// for local use, and re-export to preserve the existing `./FileTree` public surface.
import { decideTreeRefresh } from "./fileTreeRefresh";
export { decideTreeRefresh };

export function FileTree(props: { onOpen: (path: string) => void; activeFile?: string | null }) {
  // Seed from the last good tree so the sidebar paints instantly on boot; the fetch
  // still runs and reconciles. Persist every fresh, non-error response for next launch.
  const [files, { refetch, mutate }] = createResource(() => api.tree(), {
    initialValue: readCache<TreeEntry[]>(TREE_CACHE_KEY),
  });
  const [editing, setEditing] = createSignal<string | null>(null);
  const [dragPath, setDragPath] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  // Count of optimistic ops (move/rename/create/delete) whose server round-trip
  // is still outstanding. While > 0, the optimistic tree is the source of truth
  // and an SSE-driven refetch could clobber it with a stale snapshot taken
  // before the mutation landed. Signal (not a plain ref) so the refresh effect
  // re-runs and picks up any deferred change once the op settles back to 0.
  const [pendingOps, setPendingOps] = createSignal(0);
  // Run an optimistic op's server call, holding off SSE refetches until it settles.
  // Returns the call's result so callers (e.g. delete → trashPath) stay intact.
  const trackPending = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setPendingOps((n) => n + 1);
    try {
      return await fn();
    } finally {
      setPendingOps((n) => n - 1);
    }
  };
  // Persist the last good tree so the sidebar paints instantly next launch. Skip while an
  // optimistic op is in flight (pendingOps > 0) so we never cache un-confirmed state; the
  // effect re-runs and writes the settled tree once pendingOps drops back to 0.
  createEffect(() => {
    if (files.loading || files.error || pendingOps() > 0) return;
    const f = files();
    if (f) writeCache(TREE_CACHE_KEY, f);
  });
  // React to server changes instead of blind polling. The effect tracks
  // editing()/dragPath()/pendingOps() so it re-runs (and applies any deferred
  // change) once an in-flight edit/drag/optimistic op clears — see
  // decideTreeRefresh for the gating rationale (B3).
  let lastSeen = 0;
  createEffect(() => {
    const { refetch: doFetch, nextLastSeen } = decideTreeRefresh({
      change: lastChange(),
      lastSeen,
      editing: editing() !== null,
      dragging: dragPath() !== null,
      pendingOps: pendingOps(),
    });
    lastSeen = nextLastSeen;
    if (doFetch) refetch();
  });

  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const toggle = (p: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [iconPicker, setIconPicker] = createSignal<{ node: TreeNode; isDir: boolean } | null>(null);

  const refresh = () => refetch();

  // Set (or clear, when `icon` is "") a node's icon. Files store it in their
  // `icon:` frontmatter (clearing removes the key entirely); folders have none,
  // so theirs lives in settings.yaml (clearing removes that entry).
  async function applyIcon(node: TreeNode, isDir: boolean, icon: string) {
    try {
      if (isDir) await api.setFolderIcon(node.path, icon);
      else if (icon === "") await api.deleteProperty(node.path, "icon");
      else await api.setProperty(node.path, "icon", icon);
      await refresh();
    } catch (e) {
      pushToast(`Set icon failed: ${(e as Error).message}`);
    }
  }

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
      await refetch();
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
    const kind = (e as CustomEvent).detail?.kind as "file" | "dir" | "sheet" | "draw";
    if (kind === "file" || kind === "dir" || kind === "sheet" || kind === "draw") doCreate("", kind);
  };
  window.addEventListener("oa-new", onNew);
  onCleanup(() => window.removeEventListener("oa-new", onNew));

  async function doDelete(node: TreeNode) {
    optimisticRemove(node.path); // instant; reverted via refresh() on failure
    // Close any open tab for the deleted file (or files under a deleted folder).
    window.dispatchEvent(new CustomEvent("oa-deleted", { detail: node.path }));
    try {
      const { trashPath } = await trackPending(() => api.del(node.path));
      const entry = { trashPath, to: node.path, name: node.name };
      setUndoStack((s) => [entry, ...s]);
      pushToast(`Deleted ${node.name}`, { label: "Undo", onClick: () => restoreDeleted(entry) });
    } catch (e) {
      await refetch();
      pushToast(`Delete failed: ${(e as Error).message}`);
    }
  }

  async function doCreate(parentDir: string, kind: "file" | "dir" | "sheet" | "draw") {
    const fsKind: "file" | "dir" = kind === "dir" ? "dir" : "file"; // backend only knows file|dir
    const defaultName =
      kind === "dir" ? "New Folder" : kind === "sheet" ? "Untitled.sheet" : kind === "draw" ? "Untitled.draw" : "Untitled.md";
    const path = joinPath(parentDir, defaultName);
    optimisticAdd(path, fsKind); // instant; reverted via refresh() on failure
    if (parentDir) setOpen((prev) => new Set(prev).add(parentDir));
    setEditing(path);
    try {
      await trackPending(() => api.create(path, fsKind));
    } catch (e) {
      setEditing(null);
      await refetch();
      pushToast(`Create failed: ${(e as Error).message}`);
    }
  }

  function buildMenuItems(node: TreeNode): MenuItem[] {
    const isDir = !!node.children;
    const items: MenuItem[] = [];
    if (isDir) {
      items.push({ label: "New File", icon: "FilePlus", onSelect: () => doCreate(node.path, "file") });
      items.push({ label: "New Folder", icon: "FolderPlus", onSelect: () => doCreate(node.path, "dir") });
      items.push({ label: "New Spreadsheet", icon: "Table", onSelect: () => doCreate(node.path, "sheet") });
      items.push({ label: "New Drawing", icon: "PenTool", onSelect: () => doCreate(node.path, "draw") });
    }
    items.push({ label: "Set Icon…", icon: "Image", onSelect: () => setIconPicker({ node, isDir }) });
    items.push({ label: "Rename", icon: "Pencil", onSelect: () => setEditing(node.path) });
    items.push({ label: "Delete", icon: "Trash2", danger: true, separatorBefore: true, onSelect: () => doDelete(node) });
    return items;
  }

  function openMenuFor(node: TreeNode, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Native OS menu in the Tauri build; HTML ContextMenu fallback in the browser.
    openContextMenu(e.clientX, e.clientY, buildMenuItems(node), setMenu);
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
      await trackPending(() => api.move(from, to));
    } catch (e) {
      await refetch();
      pushToast(`Move failed: ${(e as Error).message}`);
    }
  }

  const endDrag = () => {
    setDragPath(null);
    setDropTarget(null);
  };

  /**
   * Shared drag-start handler for both file and folder rows.
   * `isFile` controls whether the MIME payload for pane-drop is written:
   *   - files:   setData is called so a pane can accept a drop-to-split (PaneTree DRAG_MIME).
   *   - folders: setData is intentionally omitted — panes open files, not directories,
   *              so folder drags only participate in tree re-ordering, not pane splitting.
   */
  function makeDragStart(path: string, isFile: boolean) {
    return (e: DragEvent) => {
      e.stopPropagation();
      setDragPath(path);
      if (isFile) {
        e.dataTransfer?.setData("application/x-oa-path", path);
      }
    };
  }

  return (
    <div
      class="ft-root"
      onDragOver={(e) => { e.preventDefault(); setDropTarget(""); }}
      onDrop={(e) => { e.preventDefault(); moveInto(""); }}
    >
      <Level
        node={buildTree(files() ?? [])}
        depth={0}
        open={open()}
        toggle={toggle}
        onOpen={props.onOpen}
        activeFile={props.activeFile}
        onMenu={openMenuFor}
        editing={editing()}
        setEditing={setEditing}
        refresh={refetch}
        optimisticRename={optimisticRename}
        trackPending={trackPending}
        dragPath={dragPath()}
        setDragPath={setDragPath}
        dropTarget={dropTarget()}
        setDropTarget={setDropTarget}
        moveInto={moveInto}
        endDrag={endDrag}
        makeDragStart={makeDragStart}
      />
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}
      </Show>
      <Show when={iconPicker()}>
        {(p) => (
          <IconPicker
            title={`Set icon — ${p().node.name}`}
            current={p().node.icon}
            onPick={(name) => applyIcon(p().node, p().isDir, name)}
            onClear={() => applyIcon(p().node, p().isDir, "")}
            onClose={() => setIconPicker(null)}
          />
        )}
      </Show>
    </div>
  );
}

/** Inline-editable name. Renders an auto-selected input; Enter commits via move, Escape cancels. */
function EditableLabel(props: {
  node: TreeNode; isDir: boolean; setEditing: (p: string | null) => void; refresh: () => void;
  optimisticRename: (from: string, to: string) => void;
  trackPending: <T>(fn: () => Promise<T>) => Promise<T>;
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
    // Re-apply the original hidden extension (.md/.yaml/.yml) if the user dropped it.
    const ext = props.isDir ? "" : (initial.match(STRIP_EXT)?.[0] ?? "");
    const newName = ext && !raw.toLowerCase().endsWith(ext.toLowerCase()) ? `${raw}${ext}` : raw;
    const from = props.node.path;
    const to = joinPath(parentOf(from), newName);
    props.optimisticRename(from, to); // instant; reverted via refresh() on failure
    // Keep any open tab pointing at the renamed path.
    window.dispatchEvent(new CustomEvent("oa-moved", { detail: { from, to } }));
    try {
      await props.trackPending(() => api.move(from, to));
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
        // Select the editable stem (filename without its extension) so typing replaces it.
        queueMicrotask(() => {
          el.focus();
          const dot = props.isDir ? -1 : el.value.search(STRIP_EXT);
          el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
        });
      }}
      value={initial}
      class="ft-edit-input"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
      }}
      onBlur={commit}
    />
  );
}

// Smoothly slides a folder's children open/closed via the CSS grid-rows 0fr↔1fr trick
// (animates to content height with no measuring). `mounted` keeps the subtree in the DOM
// through the close animation; `expanded` drives the transition and is flipped a frame
// after mount so the very first open animates from 0 rather than snapping. Solid keeps
// `props.children` lazy, so a never-opened folder's subtree is never built.
function Collapsible(props: { open: boolean; children: JSX.Element }) {
  const [mounted, setMounted] = createSignal(props.open);
  const [expanded, setExpanded] = createSignal(props.open);
  createEffect(() => {
    if (props.open) {
      setMounted(true);
      requestAnimationFrame(() => setExpanded(true));
    } else {
      setExpanded(false);
    }
  });
  return (
    <div
      class="ft-collapse"
      classList={{ open: expanded() }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "grid-template-rows" && !props.open) setMounted(false);
      }}
    >
      <div class="ft-collapse-inner">
        <Show when={mounted()}>{props.children}</Show>
      </div>
    </div>
  );
}

function Level(props: {
  node: TreeNode; depth: number;
  open: Set<string>; toggle: (p: string) => void; onOpen: (p: string) => void;
  activeFile?: string | null;
  onMenu: (node: TreeNode, e: MouseEvent) => void;
  editing: string | null; setEditing: (p: string | null) => void; refresh: () => void;
  optimisticRename: (from: string, to: string) => void;
  trackPending: <T>(fn: () => Promise<T>) => Promise<T>;
  dragPath: string | null; setDragPath: (p: string | null) => void;
  dropTarget: string | null; setDropTarget: (p: string | null) => void;
  moveInto: (targetDir: string) => void; endDrag: () => void;
  makeDragStart: (path: string, isFile: boolean) => (e: DragEvent) => void;
}) {
  return (
    <For each={sortedChildren(props.node)}>
      {(child) => {
        const indent = `${props.depth * 12 + 6}px`;
        // Files have no chevron, so without compensation their icon sits left of a
        // sibling folder's icon. Add the chevron (14) + gap (4) so file icons align
        // under the folder's icon and read as nested inside it.
        const fileIndent = `${props.depth * 12 + 6 + 18}px`;
        return child.children ? (
          <div>
            <div
              class="ft-row"
              classList={{ "drop-target": props.dropTarget === child.path }}
              style={{ "padding-left": indent }}
              draggable={props.editing !== child.path}
              onDragStart={props.makeDragStart(child.path, false)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); props.setDropTarget(child.path); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); props.moveInto(child.path); }}
              onDragEnd={() => props.endDrag()}
              onClick={() => { if (props.editing !== child.path) props.toggle(child.path); }}
              onContextMenu={(e) => props.onMenu(child, e)}
            >
              <Icon value={props.open.has(child.path) ? "ChevronDown" : "ChevronRight"} size={14} class="ft-chevron" />
              <Icon value={child.icon} fallback={props.open.has(child.path) ? "FolderOpen" : "Folder"} size={16} class="ft-icon" />
              <Show when={props.editing === child.path} fallback={child.name}>
                <EditableLabel node={child} isDir={true} setEditing={props.setEditing} refresh={props.refresh} optimisticRename={props.optimisticRename} trackPending={props.trackPending} />
              </Show>
            </div>
            <Collapsible open={props.open.has(child.path)}>
              <Level node={child} depth={props.depth + 1} open={props.open} toggle={props.toggle}
                onOpen={props.onOpen} activeFile={props.activeFile} onMenu={props.onMenu}
                editing={props.editing} setEditing={props.setEditing} refresh={props.refresh}
                optimisticRename={props.optimisticRename} trackPending={props.trackPending}
                dragPath={props.dragPath} setDragPath={props.setDragPath}
                dropTarget={props.dropTarget} setDropTarget={props.setDropTarget}
                moveInto={props.moveInto} endDrag={props.endDrag} makeDragStart={props.makeDragStart} />
            </Collapsible>
          </div>
        ) : (
          <div
            class="ft-row file"
            classList={{ active: child.path === props.activeFile }}
            style={{ "padding-left": fileIndent }}
            draggable={props.editing !== child.path}
            onDragStart={props.makeDragStart(child.path, true)}
            onDragEnd={() => props.endDrag()}
            onClick={() => { if (props.editing !== child.path) props.onOpen(child.path); }}
            onContextMenu={(e) => props.onMenu(child, e)}
          >
            <Icon value={child.icon} fallback={child.name.endsWith(".sheet") ? "Table" : "FileText"} size={16} class="ft-icon" />
            <Show when={props.editing === child.path} fallback={displayName(child.name)}>
              <EditableLabel node={child} isDir={false} setEditing={props.setEditing} refresh={props.refresh} optimisticRename={props.optimisticRename} trackPending={props.trackPending} />
            </Show>
          </div>
        );
      }}
    </For>
  );
}
