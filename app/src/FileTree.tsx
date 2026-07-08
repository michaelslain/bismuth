// app/src/FileTree.tsx
import { createEffect, createMemo, createResource, createSignal, For, Show, onCleanup, type JSX } from "solid-js";
import { api } from "./api";
import { readCache, writeCache } from "./viewCache";
import { lastChange } from "./serverVersion";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { openContextMenu } from "./nativeMenu";
import { pushToast } from "./Toast";
import { renameEntries, removeEntries, addEntry, uniqueChildName } from "./fileTreeOps";
import type { TreeEntry } from "../../core/src/graph";
import { SETTINGS_FILE } from "./tabIds";
import { Icon } from "./icons/Icon";
import { IconPicker } from "./icons/IconPicker";
import { BASE_VIEW_KINDS, baseTemplate, baseFileName } from "./baseViews";
import { primeNoteCache } from "./noteCache";

import { buildTree, reconcileTree, type TreeNode } from "./fileTreeModel";

// Every artifact the file tree can create in place. "base" is a `.md` seeded with
// BASE_TEMPLATE; the rest map onto the backend's blank file/dir create. Shared with
// the toolbar "+" chooser via the `bismuth-new` event (see App.tsx).
export type CreateKind = "file" | "dir" | "base" | "sheet" | "draw";

// Extensions hidden in the tree's display labels (and re-applied on rename),
// just like Obsidian hides `.md`. Markdown notes and YAML configs alike.
const STRIP_EXT = /\.(md|yaml|yml)$/i;
const displayName = (name: string) => name.replace(STRIP_EXT, "");

const TREE_CACHE_KEY = "bismuth-tree-cache-v1";

function sortedChildren(node: TreeNode): TreeNode[] {
  // The system entries — the `.daemon` folder + the `.settings` file — always sink to the bottom
  // of their level, after all the user's notes/folders.
  const isSystem = (n: TreeNode) => !!n.isSystemFolder || n.path === SETTINGS_FILE;
  return [...(node.children?.values() ?? [])].sort((a, b) => {
    const asys = isSystem(a), bsys = isSystem(b);
    if (asys !== bsys) return asys ? 1 : -1;
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

export function FileTree(props: {
  onOpen: (path: string) => void;
  activeFile?: string | null;
  // Sidebar rows drag through App's shared pointer-drag controller (dnd/viewDrag) — native HTML5
  // drag doesn't fire from synthetic/WKWebView pointers, which silently no-op'd every move (Row 73).
  startItemDrag: (e: PointerEvent, kind: "note" | "folder", path: string, label: string) => void;
  // The folder path currently under a sidebar drag ("" = the tree root), for the drop highlight.
  dropHighlight: () => string | null;
}) {
  // Seed from the last good tree so the sidebar paints instantly on boot; the fetch
  // still runs and reconciles. Persist every fresh, non-error response for next launch.
  const [files, { refetch, mutate }] = createResource(() => api.tree(), {
    initialValue: readCache<TreeEntry[]>(TREE_CACHE_KEY),
  });
  // Persistent-identity tree root: rebuild from the flat entries on every files() change, then
  // reconcile against the previous root so untouched subtrees keep their object identity — the
  // reference-keyed <For> in Level preserves those rows (DOM + handlers) instead of disposing and
  // recreating the whole visible tree on every structural edit. Any real change still busts the
  // spine of references up to the root (see reconcileTree), so updates render exactly as before.
  let prevRoot: TreeNode | undefined;
  const treeRoot = createMemo(() => {
    const next = reconcileTree(prevRoot, buildTree(files() ?? []));
    prevRoot = next;
    return next;
  });
  const [editing, setEditing] = createSignal<string | null>(null);
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
  // In-flight create requests. A new file drops straight into tree-rename mode, but
  // `api.create` is still round-tripping; if the user types a name and hits Enter fast, the
  // rename's `api.move(from,…)` could reach the server BEFORE the create lands (move 404s →
  // spurious "Rename failed" + revert). `awaitCreate(path)` lets the rename commit wait for the
  // matching create first. Keyed by a per-invocation token (a fresh Symbol), NOT the path, so two
  // concurrent creates never share a key — one's finally-cleanup can't drop the other's promise.
  // awaitCreate resolves by matching the in-flight path (now unique per uniqueChildName).
  const pendingCreate = new Map<symbol, { path: string; promise: Promise<unknown> }>();
  const awaitCreate = async (path: string) => {
    for (const { path: p, promise } of pendingCreate.values()) {
      if (p === path) { try { await promise; } catch { /* create failure is handled by doCreate */ } return; }
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
  // editing()/pendingOps() so it re-runs (and applies any deferred change) once an
  // in-flight edit/optimistic op clears — see decideTreeRefresh for the gating rationale
  // (B3). A sidebar drag no longer needs to gate a refetch: the pointer-drag controller
  // resolves its target from the live DOM on every move (elementFromPoint), and no
  // optimistic edit exists until the drop lands, so a mid-drag tree rebuild is harmless.
  let lastSeen = 0;
  createEffect(() => {
    const { refetch: doFetch, nextLastSeen } = decideTreeRefresh({
      change: lastChange(),
      lastSeen,
      editing: editing() !== null,
      dragging: false,
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

  // Multi-select for batch actions (delete). cmd/ctrl-click toggles a row; shift-click
  // extends a contiguous range from the last-clicked anchor (in visible display order);
  // a plain click clears the selection. Kept as a path set so it survives tree refreshes.
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [anchor, setAnchor] = createSignal<string | null>(null);

  // Flattened visible row order (honoring open folders), for shift-click range select.
  const visibleOrder = (): string[] => {
    const out: string[] = [];
    const walk = (node: TreeNode) => {
      for (const c of sortedChildren(node)) {
        out.push(c.path);
        if (c.children && open().has(c.path)) walk(c);
      }
    };
    walk(treeRoot());
    return out;
  };

  // Returns true if the click was consumed by selection (so the row skips open/toggle).
  const onRowClick = (node: TreeNode, e: MouseEvent): boolean => {
    if (node.isSystemFolder || node.path === SETTINGS_FILE) return false;
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      setSelected((prev) => {
        const n = new Set(prev);
        n.has(node.path) ? n.delete(node.path) : n.add(node.path);
        return n;
      });
      setAnchor(node.path);
      return true;
    }
    if (e.shiftKey && (anchor() || selected().size > 0)) {
      e.stopPropagation();
      const order = visibleOrder();
      const a = order.indexOf(anchor() ?? node.path);
      const b = order.indexOf(node.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const n = new Set(prev);
          for (let i = lo; i <= hi; i++) n.add(order[i]);
          return n;
        });
      }
      return true;
    }
    if (selected().size > 0) setSelected(new Set<string>());
    setAnchor(node.path);
    return false;
  };

  // Drop any selected path whose ancestor folder is also selected — deleting the
  // ancestor already removes it, so a separate api.del would 404 on a gone child.
  const pruneNested = (paths: string[]): string[] =>
    paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(q + "/")));

  async function doDeleteMany(paths: string[]) {
    const targets = pruneNested(paths);
    for (const p of targets) {
      optimisticRemove(p);
      window.dispatchEvent(new CustomEvent("bismuth-deleted", { detail: p }));
    }
    setSelected(new Set<string>());
    try {
      const entries = await trackPending(() =>
        Promise.all(
          targets.map(async (p) => {
            const { trashPath } = await api.del(p);
            return { trashPath, to: p, name: p.split("/").pop()! };
          }),
        ),
      );
      setUndoStack((s) => [...entries, ...s]);
      pushToast(`Deleted ${entries.length} items`, {
        label: "Undo",
        onClick: () => entries.forEach((en) => restoreDeleted(en)),
      });
    } catch (e) {
      await refetch();
      pushToast(`Delete failed: ${(e as Error).message}`);
    }
  }

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

  // Set (or clear, when `visibility` is null) a node's AI visibility. Files store it in
  // their `visibility:` frontmatter (clearing removes the key — "inherit", not "visible");
  // folders have none, so theirs lives in settings.yaml (clearing removes that entry).
  // This restricts the daemon + in-app chat's own tool calls, never the vault owner — see
  // docs/vault/visibility.md.
  async function applyVisibility(node: TreeNode, isDir: boolean, visibility: "chat-only" | "hidden" | null) {
    try {
      if (isDir) await api.setFolderVisibility(node.path, visibility);
      else if (visibility === null) await api.deleteProperty(node.path, "visibility");
      else await api.setProperty(node.path, "visibility", visibility);
      await refresh();
    } catch (e) {
      pushToast(`Set visibility failed: ${(e as Error).message}`);
    }
  }

  /** Look up a node in the current tree by its full path (root when path is ""). */
  function findNode(path: string): TreeNode | undefined {
    if (!path) return treeRoot();
    let cur: TreeNode | undefined = treeRoot();
    for (const seg of path.split("/")) {
      cur = cur?.children?.get(seg);
      if (!cur) return undefined;
    }
    return cur;
  }

  // The nearest ancestor FOLDER (deepest first, strictly above `path`) that carries its
  // own explicit visibility override — a file's own value always wins outright, so its
  // effective visibility can only diverge from its own (absent) value because of one of
  // these; same for a folder with no override of its own. Used to name the responsible
  // folder in the context menu's "Effective: …" row so it never lies about why.
  function nearestAncestorOverride(path: string): { path: string; visibility: "chat-only" | "hidden" } | null {
    const parts = path.split("/").slice(0, -1);
    for (let i = parts.length; i > 0; i--) {
      const folderPath = parts.slice(0, i).join("/");
      const v = findNode(folderPath)?.ownVisibility;
      if (v) return { path: folderPath, visibility: v };
    }
    return null;
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
    // `!e.shiftKey` matters even when an editor IS focused (so `typing` is true and this whole
    // branch is skipped): CodeMirror's own historyKeymap bindings set `preventDefault` but not
    // `stopPropagation` on Mod-z/Mod-Shift-z, so the keydown still bubbles all the way to this
    // window-level listener after CM has already handled it. Without the shift check, THIS
    // listener also matched Mod-Shift-z (`.toLowerCase()` folds "Z" back to "z" regardless of
    // Shift) whenever focus wasn't on an editable element (e.g. between two panes, or right after
    // a table-cell edit commits and blurs without refocusing the editor) — silently eating a
    // REDO keystroke as a (usually no-op) "restore last deleted file" instead of leaving it alone
    // (#44). Mod-Shift-Z has never been this app's redo-a-delete shortcut, only Mod-Z is.
    if (!typing && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoLastDelete();
      return;
    }
    // Delete/Backspace removes the current multi-selection (undoable via the toast / Cmd+Z).
    if (!typing && (e.key === "Delete" || e.key === "Backspace") && selected().size > 0) {
      e.preventDefault();
      doDeleteMany([...selected()]);
    }
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  // Header "New note" / "New folder" buttons (in App.tsx) create at the vault root.
  const onNew = (e: Event) => {
    const detail = (e as CustomEvent).detail ?? {};
    const kind = detail.kind as CreateKind;
    if (kind === "file" || kind === "dir" || kind === "base" || kind === "sheet" || kind === "draw")
      doCreate("", kind, detail.view);
  };
  window.addEventListener("bismuth-new", onNew);
  onCleanup(() => window.removeEventListener("bismuth-new", onNew));

  async function doDelete(node: TreeNode) {
    optimisticRemove(node.path); // instant; reverted via refresh() on failure
    // Close any open tab for the deleted file (or files under a deleted folder).
    window.dispatchEvent(new CustomEvent("bismuth-deleted", { detail: node.path }));
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

  async function doCreate(parentDir: string, kind: CreateKind, view?: string) {
    const fsKind: "file" | "dir" = kind === "dir" ? "dir" : "file"; // backend only knows file|dir
    // For a base, the chosen view (table/calendar/kanban/…) drives both the default
    // name and the seeded template; absent a view it falls back to a plain table base.
    const viewKind = view ? BASE_VIEW_KINDS.find((v) => v.view === view) : undefined;
    const defaultName =
      kind === "dir" ? "New Folder"
      : kind === "base" ? baseFileName(viewKind?.label ?? "Base")
      : kind === "sheet" ? "Untitled.sheet"
      : kind === "draw" ? "Untitled.draw"
      : "Untitled.md";
    // Disambiguate against the (optimistic) tree so two fast creates don't both resolve to the
    // same path — a collision dedups the 2nd optimistic add to a no-op and 409s the 2nd POST
    // /create, yanking the 1st row's inline-rename box. The 1st create's optimisticAdd already
    // shows in files(), so the 2nd call here deterministically picks the next free name.
    const name = uniqueChildName(files() ?? [], parentDir, defaultName);
    const path = joinPath(parentDir, name);
    optimisticAdd(path, fsKind); // instant; reverted via refresh() on failure
    if (parentDir) setOpen((prev) => new Set(prev).add(parentDir));
    // A base must carry `type: base` frontmatter to render as a base, so create the
    // file (api.create is collision-safe — it errors instead of clobbering an existing
    // file, unlike api.write/PUT) then seed the view's template. Open it in a new tab so
    // the view shows immediately (like New spreadsheet/drawing) rather than sitting in
    // tree-rename — a base in rename mode would just look like a blank row.
    if (kind === "base") {
      try {
        await trackPending(() => api.create(path, "file"));
        await trackPending(() => api.write(path, baseTemplate(view ?? "table")));
        window.dispatchEvent(new CustomEvent("bismuth-open", { detail: { path, newTab: true } }));
      } catch (e) {
        optimisticRemove(path);
        await refetch();
        pushToast(`Create failed: ${(e as Error).message}`);
      }
      return;
    }
    setEditing(path);
    // Seed the cache with the (empty) body BEFORE the round-trip so an immediate open
    // is a guaranteed instant cache hit instead of a GET /file that could race the
    // create (briefly flashing a spinner or 404). Dirs have no body; only prime files.
    if (fsKind === "file") primeNoteCache(path, "");
    const createP = trackPending(() => api.create(path, fsKind));
    // Expose the in-flight create so a fast rename-on-Enter can wait for it (see awaitCreate).
    // Keyed by a fresh per-invocation token so a concurrent create can't clobber this entry.
    const token = Symbol();
    pendingCreate.set(token, { path, promise: createP });
    try {
      await createP;
    } catch (e) {
      // Only tear down THIS create's own inline-rename box — a concurrent fast create now yields a
      // distinct row that may be mid-edit, and an unconditional setEditing(null) would blur-commit it.
      if (editing() === path) setEditing(null);
      await refetch();
      pushToast(`Create failed: ${(e as Error).message}`);
    } finally {
      pendingCreate.delete(token);
    }
  }

  function visibilityMenuIcon(resolved: TreeNode["visibility"]): string {
    return resolved === "hidden" ? "EyeOff" : resolved === "chat-only" ? "MessageSquareOff" : "Eye";
  }

  // The three explicit states a node can be set to from the menu. `null` clears the
  // override (delete the frontmatter key / folderVisibility entry) — the plan's "Visible
  // to Daemon + Chat" row never writes an explicit "all", matching Set Icon's clear pattern.
  const VISIBILITY_ROWS: { value: "chat-only" | "hidden" | null; label: string }[] = [
    { value: null, label: "Visible to Daemon + Chat" },
    { value: "chat-only", label: "Chat only" },
    { value: "hidden", label: "Hidden from both" },
  ];

  function buildVisibilitySubmenu(node: TreeNode, isDir: boolean): MenuItem[] {
    const own = node.ownVisibility ?? null;
    const submenu: MenuItem[] = [];
    // The node's own setting is absent yet its EFFECTIVE visibility is restricted — an
    // ancestor folder is forcing it. Name that folder so the menu never lies about why
    // picking "Visible to Daemon + Chat" here won't actually expose it.
    if (!own && node.visibility) {
      const forced = nearestAncestorOverride(node.path);
      if (forced) {
        const label = forced.visibility === "hidden" ? "Hidden" : "Chat only";
        submenu.push({ label: `Effective: ${label} — inherited from '${forced.path}/'`, disabled: true });
      }
    }
    for (const row of VISIBILITY_ROWS) {
      const active = own === row.value;
      submenu.push({
        label: active ? `✓ ${row.label}` : row.label,
        onSelect: () => applyVisibility(node, isDir, row.value),
      });
    }
    return submenu;
  }

  function buildMenuItems(node: TreeNode): MenuItem[] {
    // Right-clicking inside a multi-selection offers a single batch delete for the lot.
    const sel = selected();
    if (sel.size > 1 && sel.has(node.path)) {
      const paths = [...sel];
      return [
        { label: `Delete ${paths.length} items`, icon: "Trash2", danger: true, onSelect: () => doDeleteMany(paths) },
      ];
    }
    const isDir = !!node.children;
    const items: MenuItem[] = [];
    if (isDir) {
      items.push({ label: "New File", icon: "FilePlus", onSelect: () => doCreate(node.path, "file") });
      items.push({ label: "New Folder", icon: "FolderPlus", onSelect: () => doCreate(node.path, "dir") });
      items.push({
        label: "New Base",
        icon: "Database",
        submenu: BASE_VIEW_KINDS.map((v) => ({
          label: v.label, icon: v.icon, onSelect: () => doCreate(node.path, "base", v.view),
        })),
      });
      items.push({ label: "New Spreadsheet", icon: "Table", onSelect: () => doCreate(node.path, "sheet") });
      items.push({ label: "New Drawing", icon: "PenTool", onSelect: () => doCreate(node.path, "draw") });
    }
    // The `.settings` config file + the .daemon system folder are runtime-managed: block
    // rename/delete/set-icon so they can't be broken from the tree (the create actions above
    // stay, for hand-adding crons/memory).
    if (!node.isSystemFolder && node.path !== SETTINGS_FILE) {
      items.push({ label: "Set Icon…", icon: "Image", onSelect: () => setIconPicker({ node, isDir }) });
      items.push({ label: "Visibility", icon: visibilityMenuIcon(node.visibility), submenu: buildVisibilitySubmenu(node, isDir) });
      items.push({ label: "Rename", icon: "Pencil", onSelect: () => setEditing(node.path) });
      items.push({ label: "Delete", icon: "Trash2", danger: true, separatorBefore: true, onSelect: () => doDelete(node) });
    }
    return items;
  }

  function openMenuFor(node: TreeNode, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Native OS menu in the Tauri build; HTML ContextMenu fallback in the browser.
    openContextMenu(e.clientX, e.clientY, buildMenuItems(node), setMenu);
  }

  /** Move `from` into `targetDir` ("" = vault root). Guards no-op and into-self. Driven by the
   *  shared drag controller: App resolves a sidebar folder/root drop and dispatches
   *  `bismuth-move-into`, keeping all the optimistic-tree machinery (rename + retarget open tab +
   *  revert-on-failure) here where it belongs. This is the on-disk MOVE that Row 73 was missing —
   *  native HTML5 drag never fired the old handler under WKWebView/synthetic pointers. */
  async function moveIntoFrom(from: string, targetDir: string) {
    if (!from) return;
    if (parentOf(from) === targetDir) return; // already there
    if (targetDir === from || targetDir.startsWith(from + "/")) return; // into itself/descendant
    const to = joinPath(targetDir, from.split("/").pop()!);
    optimisticRename(from, to); // instant; reverted via refresh() on failure
    // Keep any open tab pointing at the moved path (incl. files under a moved folder).
    window.dispatchEvent(new CustomEvent("bismuth-moved", { detail: { from, to } }));
    if (targetDir) setOpen((prev) => new Set(prev).add(targetDir));
    try {
      await trackPending(() => api.move(from, to));
    } catch (e) {
      await refetch();
      pushToast(`Move failed: ${(e as Error).message}`);
    }
  }

  const onMoveInto = (e: Event) => {
    const d = (e as CustomEvent).detail as { from?: string; targetDir?: string } | undefined;
    if (!d?.from) return;
    void moveIntoFrom(d.from, d.targetDir ?? "");
  };
  window.addEventListener("bismuth-move-into", onMoveInto);
  onCleanup(() => window.removeEventListener("bismuth-move-into", onMoveInto));

  return (
    <div
      class="ft-root"
      classList={{ "drop-target": props.dropHighlight() === "" }}
      data-drop-root="true"
      onClick={(e) => { if (e.target === e.currentTarget && selected().size > 0) setSelected(new Set<string>()); }}
    >
      <Level
        node={treeRoot()}
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
        awaitCreate={awaitCreate}
        selected={selected()}
        onRowClick={onRowClick}
        startItemDrag={props.startItemDrag}
        dropHighlight={props.dropHighlight}
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
  awaitCreate: (path: string) => Promise<void>;
}) {
  let inputRef: HTMLInputElement | undefined;
  const initial = props.node.name;
  // The input shows the extension-STRIPPED stem (like Obsidian hides `.md`), so the
  // user never sees or has to preserve the `.md`/`.yaml`/`.yml`. The extension is
  // re-applied on commit. Dirs (and any name without a hidden ext) have ext="" and
  // stem === initial. `.slice` (not `.replace`) so a multi-dot name like
  // `notes.v2.md` strips only the trailing `.md`, leaving `notes.v2`.
  const ext = props.isDir ? "" : (initial.match(STRIP_EXT)?.[0] ?? "");
  const stem = ext ? initial.slice(0, initial.length - ext.length) : initial;
  // setEditing(null) unmounts the input, which fires blur → a second commit.
  // `done` makes the rename (or cancel) run exactly once.
  let done = false;

  const commit = async () => {
    if (done) return;
    done = true;
    const raw = inputRef?.value.trim() ?? "";
    props.setEditing(null);
    if (!raw || raw === stem) return; // no-op (input holds the stem, not the full name)
    // Re-apply the original hidden extension (.md/.yaml/.yml) if the user dropped it.
    const newName = ext && !raw.toLowerCase().endsWith(ext.toLowerCase()) ? `${raw}${ext}` : raw;
    if (newName === initial) return; // typed the exact current name back (e.g. with the ext) → silent no-op, not an EEXIST error
    const from = props.node.path;
    const to = joinPath(parentOf(from), newName);
    props.optimisticRename(from, to); // instant; reverted via refresh() on failure
    // Keep any open tab pointing at the renamed path.
    window.dispatchEvent(new CustomEvent("bismuth-moved", { detail: { from, to } }));
    try {
      // If this row was just created, its `api.create` may still be in flight —
      // wait for it so the move never races ahead of the file's existence on disk.
      await props.awaitCreate(from);
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
        // The value is already the extension-stripped stem, so just select it all.
        queueMicrotask(() => {
          el.focus();
          el.select();
        });
      }}
      value={stem}
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

// Small glyph beside a row's icon, driven by the RESOLVED visibility (TreeEntry/TreeNode
// `visibility` — omitted for "all"), so a plain file deep inside a hidden folder still
// shows the badge without its own frontmatter. Distinct glyph per tier; tooltip names who
// it's hidden from. Restricts the daemon + in-app chat only — see docs/vault/visibility.md.
function VisibilityBadge(props: { visibility?: "chat-only" | "hidden" }) {
  return (
    <Show when={props.visibility}>
      {(v) => (
        <span
          class="ft-visibility-badge"
          classList={{ hidden: v() === "hidden" }}
          title={v() === "hidden" ? "Hidden from the daemon and in-app chat" : "Chat only — hidden from the daemon"}
        >
          <Icon value={v() === "hidden" ? "EyeOff" : "MessageSquareOff"} size={12} />
        </span>
      )}
    </Show>
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
  awaitCreate: (path: string) => Promise<void>;
  selected: Set<string>; onRowClick: (node: TreeNode, e: MouseEvent) => boolean;
  startItemDrag: (e: PointerEvent, kind: "note" | "folder", path: string, label: string) => void;
  dropHighlight: () => string | null;
}) {
  // Begin a pointer-drag of a row (unless it's being renamed or is a protected system node). The
  // native tap (open/toggle/select) stays on the row's onClick; a real drag swallows that click.
  const onRowPointerDown = (e: PointerEvent, node: TreeNode, kind: "note" | "folder", label: string) => {
    if (e.button !== 0) return;
    if (props.editing === node.path) return;
    if (node.isSystemFolder || node.path === SETTINGS_FILE) return;
    if ((e.target as HTMLElement).closest(".ft-edit-input")) return;
    e.stopPropagation(); // don't let a nested row's press bubble to an ancestor row
    props.startItemDrag(e, kind, node.path, label);
  };
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
              classList={{ "drop-target": props.dropHighlight() === child.path, system: !!child.isSystemFolder, selected: props.selected.has(child.path) }}
              style={{ "padding-left": indent }}
              data-drop-folder={child.isSystemFolder ? undefined : child.path}
              onPointerDown={(e) => onRowPointerDown(e, child, "folder", child.label ?? child.name)}
              onClick={(e) => { if (props.editing === child.path) return; if (props.onRowClick(child, e)) return; props.toggle(child.path); }}
              onContextMenu={(e) => props.onMenu(child, e)}
            >
              <Icon value={props.open.has(child.path) ? "ChevronDown" : "ChevronRight"} size={14} class="ft-chevron" />
              <Icon value={child.icon} fallback={child.isSystemFolder ? "Settings2" : props.open.has(child.path) ? "FolderOpen" : "Folder"} size={16} class="ft-icon" />
              <VisibilityBadge visibility={child.visibility} />
              <Show when={props.editing === child.path} fallback={child.label ?? child.name}>
                <EditableLabel node={child} isDir={true} setEditing={props.setEditing} refresh={props.refresh} optimisticRename={props.optimisticRename} trackPending={props.trackPending} awaitCreate={props.awaitCreate} />
              </Show>
            </div>
            <Collapsible open={props.open.has(child.path)}>
              <Level node={child} depth={props.depth + 1} open={props.open} toggle={props.toggle}
                onOpen={props.onOpen} activeFile={props.activeFile} onMenu={props.onMenu}
                editing={props.editing} setEditing={props.setEditing} refresh={props.refresh}
                optimisticRename={props.optimisticRename} trackPending={props.trackPending}
                awaitCreate={props.awaitCreate} selected={props.selected} onRowClick={props.onRowClick}
                startItemDrag={props.startItemDrag} dropHighlight={props.dropHighlight} />
            </Collapsible>
          </div>
        ) : (
          <div
            class="ft-row file"
            classList={{ active: child.path === props.activeFile, system: child.path === SETTINGS_FILE, selected: props.selected.has(child.path) }}
            style={{ "padding-left": fileIndent }}
            onPointerDown={(e) => onRowPointerDown(e, child, "note", child.label ?? displayName(child.name))}
            onClick={(e) => { if (props.editing === child.path) return; if (props.onRowClick(child, e)) return; props.onOpen(child.path); }}
            onContextMenu={(e) => props.onMenu(child, e)}
          >
            <Icon value={child.icon} fallback={child.name.endsWith(".sheet") ? "Table" : "FileText"} size={16} class="ft-icon" />
            <VisibilityBadge visibility={child.visibility} />
            <Show when={props.editing === child.path} fallback={child.label ?? displayName(child.name)}>
              <EditableLabel node={child} isDir={false} setEditing={props.setEditing} refresh={props.refresh} optimisticRename={props.optimisticRename} trackPending={props.trackPending} awaitCreate={props.awaitCreate} />
            </Show>
          </div>
        );
      }}
    </For>
  );
}
