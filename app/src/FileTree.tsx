// app/src/FileTree.tsx
import {
    createEffect,
    createMemo,
    createResource,
    createSignal,
    For,
    Show,
    onCleanup,
} from 'solid-js'
import { api, cacheScope } from './api'
import { readCache, writeCache, scopedKey } from './viewCache'
import { lastChange } from './serverVersion'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { openContextMenu } from './nativeMenu'
import { pushToast } from './Toast'
import {
    renameEntries,
    removeEntries,
    addEntry,
    uniqueChildName,
} from './fileTreeOps'
import type { TreeEntry } from '../../core/src/graph'
import { SETTINGS_FILE } from './tabIds'
import { Icon } from './icons/Icon'
import { IconPicker } from './icons/IconPicker'
import { BASE_VIEW_KINDS, baseTemplate, baseFileName } from './baseViews'
import { primeNoteCache } from './noteCache'
import { settings } from './settings'
import { applyNewNoteTemplate } from '../../core/src/newNoteTemplate'
import { NOTE_EXT_RE } from '../../core/src/pathUtils'
import { setPendingCursor } from './pendingCursor'
import { createRenameSettleRegistry } from './renameSettle'
import { isTypingTarget } from './editableTarget'
import Collapsible from './Collapsible'
import VisibilityBadge from './VisibilityBadge'
// Scoped chrome. Bracket access, not `styles.ftRow`: vite.config.ts sets no
// `css.modules.localsConvention`, so only the literal names exist on this object.
import styles from './FileTree.module.css'
import { treePrefix } from './ui/ascii/treePrefix'

import { buildTree, reconcileTree, type TreeNode } from './fileTreeModel'

// Every artifact the file tree can create in place. "base" is a `.md` seeded with
// BASE_TEMPLATE; the rest map onto the backend's blank file/dir create. Shared with
// the toolbar "+" chooser via the `bismuth-new` event (see App.tsx).
export type CreateKind = 'file' | 'dir' | 'base' | 'sheet' | 'draw'

// Extensions hidden in the tree's display labels (and re-applied on rename), just like Obsidian
// hides `.md`. Markdown notes and YAML configs alike. Shared with core (`noteStem`, which derives
// a template's `{{title}}`) so the two can't disagree about where a name ends.
const displayName = (name: string) => name.replace(NOTE_EXT_RE, '')

const TREE_CACHE_KEY = 'bismuth-tree-cache-v1'

function sortedChildren(node: TreeNode): TreeNode[] {
    // The system entries — the `.daemon` folder + the `.settings` file — always sink to the bottom
    // of their level, after all the user's notes/folders.
    const isSystem = (n: TreeNode) =>
        !!n.isSystemFolder || n.path === SETTINGS_FILE
    return [...(node.children?.values() ?? [])].sort((a, b) => {
        const asys = isSystem(a),
            bsys = isSystem(b)
        if (asys !== bsys) return asys ? 1 : -1
        const af = !!a.children,
            bf = !!b.children
        if (af !== bf) return af ? -1 : 1
        return a.name.localeCompare(b.name)
    })
}

function parentOf(path: string): string {
    const i = path.lastIndexOf('/')
    return i === -1 ? '' : path.slice(0, i)
}

function joinPath(dir: string, name: string): string {
    return dir ? `${dir}/${name}` : name
}

// Pure SSE-refresh decision logic lives in its own module so it can be unit-tested
// headlessly without importing this component tree (Solid client-only code, CodeMirror, …). Import
// for local use, and re-export to preserve the existing `./FileTree` public surface.
import { decideTreeRefresh } from './fileTreeRefresh'
export { decideTreeRefresh }

export function FileTree(props: {
    onOpen: (path: string) => void
    activeFile?: string | null
    // Sidebar rows drag through App's shared pointer-drag controller (dnd/viewDrag) — native HTML5
    // drag doesn't fire from synthetic/WKWebView pointers, which silently no-op'd every move (Row 73).
    startItemDrag: (
        e: PointerEvent,
        kind: 'note' | 'folder',
        path: string,
        label: string,
    ) => void
    // The folder path currently under a sidebar drag ("" = the tree root), for the drop highlight.
    dropHighlight: () => string | null
}) {
    // Guards an optimistic edit against a /tree fetch that was ALREADY in flight when
    // the edit happened. Solid's `mutate` is a raw signal setter: it does not clear the
    // resource's pending promise, and `loadEnd` only discards fetches that are
    // out-of-ORDER (a newer fetch superseding an older one) — never one that a
    // mutation overtook. So a response that left the server before the delete/rename
    // landed would still be applied on arrival, resurrecting the row the user just
    // removed. `optimisticEpoch` bumps on every optimistic edit; a fetch that started
    // under an older epoch resolves to the optimistic tree instead of its own stale
    // snapshot. The reconciling refetch still arrives once pendingOps settles
    // (see decideTreeRefresh), so this defers to the server rather than fighting it.
    let optimisticEpoch = 0
    let optimisticTree: TreeEntry[] | null = null
    // Seed from the last good tree so the sidebar paints instantly on boot; the fetch
    // still runs and reconciles. Persist every fresh, non-error response for next launch.
    const [files, { refetch, mutate }] = createResource(
        async () => {
            const epoch = optimisticEpoch
            const fetched = await api.tree()
            if (epoch !== optimisticEpoch && optimisticTree)
                return optimisticTree
            optimisticTree = null // reconciled with the server; nothing left to protect
            return fetched
        },
        {
            initialValue: readCache<TreeEntry[]>(
                scopedKey(TREE_CACHE_KEY, cacheScope()),
            ),
        },
    )
    // Persistent-identity tree root: rebuild from the flat entries on every files() change, then
    // reconcile against the previous root so untouched subtrees keep their object identity — the
    // reference-keyed <For> in Level preserves those rows (DOM + handlers) instead of disposing and
    // recreating the whole visible tree on every structural edit. Any real change still busts the
    // spine of references up to the root (see reconcileTree), so updates render exactly as before.
    let prevRoot: TreeNode | undefined
    const treeRoot = createMemo(() => {
        const next = reconcileTree(prevRoot, buildTree(files() ?? []))
        prevRoot = next
        return next
    })
    const [editing, setEditing] = createSignal<string | null>(null)
    // Count of optimistic ops (move/rename/create/delete) whose server round-trip
    // is still outstanding. While > 0, the optimistic tree is the source of truth
    // and an SSE-driven refetch could clobber it with a stale snapshot taken
    // before the mutation landed. Signal (not a plain ref) so the refresh effect
    // re-runs and picks up any deferred change once the op settles back to 0.
    const [pendingOps, setPendingOps] = createSignal(0)
    // Run an optimistic op's server call, holding off SSE refetches until it settles.
    // Returns the call's result so callers (e.g. delete → trashPath) stay intact.
    const trackPending = async <T,>(fn: () => Promise<T>): Promise<T> => {
        setPendingOps(n => n + 1)
        try {
            return await fn()
        } finally {
            setPendingOps(n => n - 1)
        }
    }
    // In-flight create requests. A new file drops straight into tree-rename mode, but
    // `api.create` is still round-tripping; if the user types a name and hits Enter fast, the
    // rename's `api.move(from,…)` could reach the server BEFORE the create lands (move 404s →
    // spurious "Rename failed" + revert). `awaitCreate(path)` lets the rename commit wait for the
    // matching create first. Keyed by a per-invocation token (a fresh Symbol), NOT the path, so two
    // concurrent creates never share a key — one's finally-cleanup can't drop the other's promise.
    // awaitCreate resolves by matching the in-flight path (now unique per uniqueChildName).
    const pendingCreate = new Map<
        symbol,
        { path: string; promise: Promise<unknown> }
    >()
    const awaitCreate = async (path: string) => {
        for (const { path: p, promise } of pendingCreate.values()) {
            if (p === path) {
                try {
                    await promise
                } catch {
                    /* create failure is handled by doCreate */
                }
                return
            }
        }
    }
    // Where a just-created row FINALLY lands (renameSettle.ts). A new note is created under a
    // placeholder name ("Untitled.md") and drops straight into inline rename, so its create-time
    // path is almost never the path it keeps — and the new-note template's {{title}}/{{cursor}}/
    // note-cache entry must all bind to the kept one (core/src/newNoteTemplate.ts). doCreate parks
    // a waiter here keyed by the CREATE path; EditableLabel reports the settled path once its
    // rename is over. Per-instance, not module-global, so two windows never share waiters.
    const renameSettle = createRenameSettleRegistry()
    // Persist the last good tree so the sidebar paints instantly next launch. Skip while an
    // optimistic op is in flight (pendingOps > 0) so we never cache un-confirmed state; the
    // effect re-runs and writes the settled tree once pendingOps drops back to 0.
    createEffect(() => {
        if (files.loading || files.error || pendingOps() > 0) return
        const f = files()
        if (f) writeCache(scopedKey(TREE_CACHE_KEY, cacheScope()), f)
    })
    // React to server changes instead of blind polling. The effect tracks
    // editing()/pendingOps() so it re-runs (and applies any deferred change) once an
    // in-flight edit/optimistic op clears — see decideTreeRefresh for the gating rationale
    // (B3). A sidebar drag no longer needs to gate a refetch: the pointer-drag controller
    // resolves its target from the live DOM on every move (elementFromPoint), and no
    // optimistic edit exists until the drop lands, so a mid-drag tree rebuild is harmless.
    let lastSeen = 0
    createEffect(() => {
        const { refetch: doFetch, nextLastSeen } = decideTreeRefresh({
            change: lastChange(),
            lastSeen,
            editing: editing() !== null,
            dragging: false,
            pendingOps: pendingOps(),
        })
        lastSeen = nextLastSeen
        if (doFetch) refetch()
    })

    const [open, setOpen] = createSignal<Set<string>>(new Set())
    const toggle = (p: string) =>
        setOpen(prev => {
            const n = new Set(prev)
            n.has(p) ? n.delete(p) : n.add(p)
            return n
        })

    // Multi-select for batch actions (delete). cmd/ctrl-click toggles a row; shift-click
    // extends a contiguous range from the last-clicked anchor (in visible display order);
    // a plain click clears the selection. Kept as a path set so it survives tree refreshes.
    const [selected, setSelected] = createSignal<Set<string>>(new Set())
    const [anchor, setAnchor] = createSignal<string | null>(null)

    // Flattened visible row order (honoring open folders), for shift-click range select.
    const visibleOrder = (): string[] => {
        const out: string[] = []
        const walk = (node: TreeNode) => {
            for (const c of sortedChildren(node)) {
                out.push(c.path)
                if (c.children && open().has(c.path)) walk(c)
            }
        }
        walk(treeRoot())
        return out
    }

    // Returns true if the click was consumed by selection (so the row skips open/toggle).
    const onRowClick = (node: TreeNode, e: MouseEvent): boolean => {
        if (node.isSystemFolder || node.path === SETTINGS_FILE) return false
        if (e.metaKey || e.ctrlKey) {
            e.stopPropagation()
            setSelected(prev => {
                const n = new Set(prev)
                n.has(node.path) ? n.delete(node.path) : n.add(node.path)
                return n
            })
            setAnchor(node.path)
            return true
        }
        if (e.shiftKey && (anchor() || selected().size > 0)) {
            e.stopPropagation()
            const order = visibleOrder()
            const a = order.indexOf(anchor() ?? node.path)
            const b = order.indexOf(node.path)
            if (a >= 0 && b >= 0) {
                const [lo, hi] = a < b ? [a, b] : [b, a]
                setSelected(prev => {
                    const n = new Set(prev)
                    for (let i = lo; i <= hi; i++) n.add(order[i])
                    return n
                })
            }
            return true
        }
        if (selected().size > 0) setSelected(new Set<string>())
        setAnchor(node.path)
        return false
    }

    // Drop any selected path whose ancestor folder is also selected — deleting the
    // ancestor already removes it, so a separate api.del would 404 on a gone child.
    const pruneNested = (paths: string[]): string[] =>
        paths.filter(p => !paths.some(q => q !== p && p.startsWith(q + '/')))

    async function doDeleteMany(paths: string[]) {
        const targets = pruneNested(paths)
        for (const p of targets) {
            optimisticRemove(p)
            window.dispatchEvent(
                new CustomEvent('bismuth-deleted', { detail: p }),
            )
        }
        setSelected(new Set<string>())
        try {
            const entries = await trackPending(() =>
                Promise.all(
                    targets.map(async p => {
                        const { trashPath } = await api.del(p)
                        return { trashPath, to: p, name: p.split('/').pop()! }
                    }),
                ),
            )
            setUndoStack(s => [...entries, ...s])
            pushToast(`Deleted ${entries.length} items`, {
                label: 'Undo',
                onClick: () => entries.forEach(en => restoreDeleted(en)),
            })
        } catch (e) {
            await refetch()
            pushToast(`Delete failed: ${(e as Error).message}`)
        }
    }

    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        items: MenuItem[]
    } | null>(null)
    const [iconPicker, setIconPicker] = createSignal<{
        node: TreeNode
        isDir: boolean
    } | null>(null)

    const refresh = () => refetch()

    // Set (or clear, when `icon` is "") a node's icon. Files store it in their
    // `icon:` frontmatter (clearing removes the key entirely); folders have none,
    // so theirs lives in settings.yaml (clearing removes that entry).
    async function applyIcon(node: TreeNode, isDir: boolean, icon: string) {
        try {
            if (isDir) await api.setFolderIcon(node.path, icon)
            else if (icon === '') await api.deleteProperty(node.path, 'icon')
            else await api.setProperty(node.path, 'icon', icon)
            await refresh()
        } catch (e) {
            pushToast(`Set icon failed: ${(e as Error).message}`)
        }
    }

    // Set (or clear, when `visibility` is null) a node's AI visibility. Files store it in
    // their `visibility:` frontmatter (clearing removes the key — "inherit", not "visible");
    // folders have none, so theirs lives in settings.yaml (clearing removes that entry).
    // This restricts the daemon + in-app chat's own tool calls, never the vault owner — see
    // docs/vault/visibility.md.
    async function applyVisibility(
        node: TreeNode,
        isDir: boolean,
        visibility: 'chat-only' | 'hidden' | null,
    ) {
        try {
            if (isDir) await api.setFolderVisibility(node.path, visibility)
            else if (visibility === null)
                await api.deleteProperty(node.path, 'visibility')
            else await api.setProperty(node.path, 'visibility', visibility)
            await refresh()
        } catch (e) {
            pushToast(`Set visibility failed: ${(e as Error).message}`)
        }
    }

    /** Look up a node in the current tree by its full path (root when path is ""). */
    function findNode(path: string): TreeNode | undefined {
        if (!path) return treeRoot()
        let cur: TreeNode | undefined = treeRoot()
        for (const seg of path.split('/')) {
            cur = cur?.children?.get(seg)
            if (!cur) return undefined
        }
        return cur
    }

    // The nearest ancestor FOLDER (deepest first, strictly above `path`) that carries its
    // own explicit visibility override — a file's own value always wins outright, so its
    // effective visibility can only diverge from its own (absent) value because of one of
    // these; same for a folder with no override of its own. Used to name the responsible
    // folder in the context menu's "Effective: …" row so it never lies about why.
    function nearestAncestorOverride(
        path: string,
    ): { path: string; visibility: 'chat-only' | 'hidden' } | null {
        const parts = path.split('/').slice(0, -1)
        for (let i = parts.length; i > 0; i--) {
            const folderPath = parts.slice(0, i).join('/')
            const v = findNode(folderPath)?.ownVisibility
            if (v) return { path: folderPath, visibility: v }
        }
        return null
    }

    // Optimistic local edits: apply the change to the tree instantly so the UI
    // reflects it without waiting for a /tree round-trip (which contends with the
    // server's graph rebuild). The op's own success path needs no refetch — the
    // optimistic state already matches the server; we only refresh() to *revert*
    // if the server call fails.
    // Every optimistic edit goes through here so it both updates the resource AND
    // records the epoch/tree the fetcher above needs to reject a pre-edit response.
    const applyOptimistic = (fn: (cur: TreeEntry[]) => TreeEntry[]) => {
        optimisticEpoch++
        mutate(cur => (optimisticTree = fn(cur ?? [])))
    }
    const optimisticRename = (from: string, to: string) =>
        applyOptimistic(cur => renameEntries(cur, from, to))
    const optimisticRemove = (path: string) =>
        applyOptimistic(cur => removeEntries(cur, path))
    const optimisticAdd = (path: string, kind: 'file' | 'dir') =>
        applyOptimistic(cur => addEntry(cur, path, kind))

    // LIFO stack of undoable deletes (most-recent first).
    const [undoStack, setUndoStack] = createSignal<
        { trashPath: string; to: string; name: string }[]
    >([])

    // Restore one trashed entry (drop it from the undo stack, move it back, refetch, toast).
    // Shared by the Cmd+Z handler and the delete toast's "Undo" button.
    async function restoreDeleted(entry: {
        trashPath: string
        to: string
        name: string
    }) {
        setUndoStack(s => s.filter(u => u.trashPath !== entry.trashPath))
        try {
            await api.restore(entry.trashPath, entry.to)
            await refetch()
            pushToast(`Restored ${entry.name}`)
        } catch (e) {
            pushToast(`Restore failed: ${(e as Error).message}`)
        }
    }

    function undoLastDelete() {
        const last = undoStack()[0]
        if (last) restoreDeleted(last)
    }

    const onKey = (e: KeyboardEvent) => {
        const typing = isTypingTarget(e.target)
        // `!e.shiftKey` matters even when an editor IS focused (so `typing` is true and this whole
        // branch is skipped): CodeMirror's own historyKeymap bindings set `preventDefault` but not
        // `stopPropagation` on Mod-z/Mod-Shift-z, so the keydown still bubbles all the way to this
        // window-level listener after CM has already handled it. Without the shift check, THIS
        // listener also matched Mod-Shift-z (`.toLowerCase()` folds "Z" back to "z" regardless of
        // Shift) whenever focus wasn't on an editable element (e.g. between two panes, or right after
        // a table-cell edit commits and blurs without refocusing the editor) — silently eating a
        // REDO keystroke as a (usually no-op) "restore last deleted file" instead of leaving it alone
        // (#44). Mod-Shift-Z has never been this app's redo-a-delete shortcut, only Mod-Z is.
        if (
            !typing &&
            (e.metaKey || e.ctrlKey) &&
            !e.shiftKey &&
            e.key.toLowerCase() === 'z'
        ) {
            e.preventDefault()
            undoLastDelete()
            return
        }
        // Delete/Backspace removes the current multi-selection (undoable via the toast / Cmd+Z).
        if (
            !typing &&
            (e.key === 'Delete' || e.key === 'Backspace') &&
            selected().size > 0
        ) {
            e.preventDefault()
            doDeleteMany([...selected()])
        }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))

    // Header "New note" / "New folder" buttons (in App.tsx) create at the vault root.
    const onNew = (e: Event) => {
        const detail = (e as CustomEvent).detail ?? {}
        const kind = detail.kind as CreateKind
        if (
            kind === 'file' ||
            kind === 'dir' ||
            kind === 'base' ||
            kind === 'sheet' ||
            kind === 'draw'
        )
            doCreate('', kind, detail.view)
    }
    window.addEventListener('bismuth-new', onNew)
    onCleanup(() => window.removeEventListener('bismuth-new', onNew))

    async function doDelete(node: TreeNode) {
        optimisticRemove(node.path) // instant; reverted via refresh() on failure
        // Close any open tab for the deleted file (or files under a deleted folder).
        window.dispatchEvent(
            new CustomEvent('bismuth-deleted', { detail: node.path }),
        )
        try {
            const { trashPath } = await trackPending(() => api.del(node.path))
            const entry = { trashPath, to: node.path, name: node.name }
            setUndoStack(s => [entry, ...s])
            pushToast(`Deleted ${node.name}`, {
                label: 'Undo',
                onClick: () => restoreDeleted(entry),
            })
        } catch (e) {
            await refetch()
            pushToast(`Delete failed: ${(e as Error).message}`)
        }
    }

    async function doCreate(
        parentDir: string,
        kind: CreateKind,
        view?: string,
    ) {
        const fsKind: 'file' | 'dir' = kind === 'dir' ? 'dir' : 'file' // backend only knows file|dir
        // For a base, the chosen view (table/calendar/kanban/…) drives both the default
        // name and the seeded template; absent a view it falls back to a plain table base.
        const viewKind = view
            ? BASE_VIEW_KINDS.find(v => v.view === view)
            : undefined
        const defaultName =
            kind === 'dir'
                ? 'New Folder'
                : kind === 'base'
                  ? baseFileName(viewKind?.label ?? 'Base')
                  : kind === 'sheet'
                    ? 'Untitled.sheet'
                    : kind === 'draw'
                      ? 'Untitled.draw'
                      : 'Untitled.md'
        // Disambiguate against the (optimistic) tree so two fast creates don't both resolve to the
        // same path — a collision dedups the 2nd optimistic add to a no-op and 409s the 2nd POST
        // /create, yanking the 1st row's inline-rename box. The 1st create's optimisticAdd already
        // shows in files(), so the 2nd call here deterministically picks the next free name.
        const name = uniqueChildName(files() ?? [], parentDir, defaultName)
        const path = joinPath(parentDir, name)
        optimisticAdd(path, fsKind) // instant; reverted via refresh() on failure
        if (parentDir) setOpen(prev => new Set(prev).add(parentDir))
        // A base must carry `type: base` frontmatter to render as a base, so create the
        // file (api.create is collision-safe — it errors instead of clobbering an existing
        // file, unlike api.write/PUT) then seed the view's template. Open it in a new tab so
        // the view shows immediately (like New spreadsheet/drawing) rather than sitting in
        // tree-rename — a base in rename mode would just look like a blank row.
        if (kind === 'base') {
            try {
                await trackPending(() => api.create(path, 'file'))
                await trackPending(() =>
                    api.write(path, baseTemplate(view ?? 'table')),
                )
                window.dispatchEvent(
                    new CustomEvent('bismuth-open', {
                        detail: { path, newTab: true },
                    }),
                )
            } catch (e) {
                optimisticRemove(path)
                await refetch()
                pushToast(`Create failed: ${(e as Error).message}`)
            }
            return
        }
        // Register the settle waiter BEFORE handing the row to inline rename: a fast Enter can commit
        // (and report) before the create round-trip even resolves, and an unregistered report is
        // silently dropped. Only a plain note is templated — sheet/draw/base seed their own content.
        const settledPath = kind === 'file' ? renameSettle.waitFor(path) : null
        // Snapshot the template config + clock at CREATE time, not at settle time: {{date}}/{{time}}
        // should read as the moment the note came into existence, however long the user then spends
        // deciding on its name.
        const templatePath = settings.templates.newNote
        const createdAt = new Date()
        setEditing(path)
        // Seed the cache with the (empty) body BEFORE the round-trip so an immediate open
        // is a guaranteed instant cache hit instead of a GET /file that could race the
        // create (briefly flashing a spinner or 404). Dirs have no body; only prime files.
        if (fsKind === 'file') primeNoteCache(path, '')
        const createP = trackPending(() => api.create(path, fsKind))
        // Expose the in-flight create so a fast rename-on-Enter can wait for it (see awaitCreate).
        // Keyed by a fresh per-invocation token so a concurrent create can't clobber this entry.
        const token = Symbol()
        pendingCreate.set(token, { path, promise: createP })
        try {
            await createP
        } catch (e) {
            // Only tear down THIS create's own inline-rename box — a concurrent fast create now yields a
            // distinct row that may be mid-edit, and an unconditional setEditing(null) would blur-commit it.
            if (editing() === path) setEditing(null)
            renameSettle.cancel(path) // nothing to template — the note never made it to disk
            await refetch()
            pushToast(`Create failed: ${(e as Error).message}`)
            return
        } finally {
            pendingCreate.delete(token)
        }
        if (!settledPath) return
        // A plain new note can be pre-filled from a configured template (settings.templates.newNote →
        // core/src/newNoteTemplate.ts), mirroring the daily-note template pattern (dailyNote.ts).
        // The template READ starts as soon as the create lands (overlapping the user typing a name),
        // but the expand + write wait for `settledPath` — the note's post-rename resting place — so
        // {{title}} is the name the user actually typed, and the write, the note-cache prime and the
        // caret offset all land on a path that still exists. Nothing here gates the create or the
        // rename: both have already resolved by this line.
        try {
            await applyNewNoteTemplate({
                templatePath,
                now: createdAt,
                settledPath,
                io: {
                    readTemplate: p => api.read(p),
                    write: (p, text) =>
                        api.write(p, text).then(() => undefined),
                    primeCache: primeNoteCache,
                    setCursor: setPendingCursor,
                },
            })
        } catch (e) {
            // The note exists and is usable (just empty); only the template body failed to land.
            pushToast(`Template failed: ${(e as Error).message}`)
        }
    }

    function visibilityMenuIcon(resolved: TreeNode['visibility']): string {
        return resolved === 'hidden'
            ? 'EyeOff'
            : resolved === 'chat-only'
              ? 'MessageSquareOff'
              : 'Eye'
    }

    // The three explicit states a node can be set to from the menu. `null` clears the
    // override (delete the frontmatter key / folderVisibility entry) — the plan's "Visible
    // to Daemon + Chat" row never writes an explicit "all", matching Set Icon's clear pattern.
    const VISIBILITY_ROWS: {
        value: 'chat-only' | 'hidden' | null
        label: string
    }[] = [
        { value: null, label: 'Visible to Daemon + Chat' },
        { value: 'chat-only', label: 'Chat only' },
        { value: 'hidden', label: 'Hidden from both' },
    ]

    function buildVisibilitySubmenu(
        node: TreeNode,
        isDir: boolean,
    ): MenuItem[] {
        const own = node.ownVisibility ?? null
        const submenu: MenuItem[] = []
        // The node's own setting is absent yet its EFFECTIVE visibility is restricted — an
        // ancestor folder is forcing it. Name that folder so the menu never lies about why
        // picking "Visible to Daemon + Chat" here won't actually expose it.
        if (!own && node.visibility) {
            const forced = nearestAncestorOverride(node.path)
            if (forced) {
                const label =
                    forced.visibility === 'hidden' ? 'Hidden' : 'Chat only'
                submenu.push({
                    label: `Effective: ${label} — inherited from '${forced.path}/'`,
                    disabled: true,
                })
            }
        }
        for (const row of VISIBILITY_ROWS) {
            const active = own === row.value
            submenu.push({
                label: row.label,
                icon: active ? 'Check' : undefined,
                onSelect: () => applyVisibility(node, isDir, row.value),
            })
        }
        return submenu
    }

    function buildMenuItems(node: TreeNode): MenuItem[] {
        // Right-clicking inside a multi-selection offers a single batch delete for the lot.
        const sel = selected()
        if (sel.size > 1 && sel.has(node.path)) {
            const paths = [...sel]
            return [
                {
                    label: `Delete ${paths.length} items`,
                    icon: 'Trash2',
                    danger: true,
                    onSelect: () => doDeleteMany(paths),
                },
            ]
        }
        const isDir = !!node.children
        const items: MenuItem[] = []
        if (isDir) {
            items.push({
                label: 'New File',
                icon: 'FilePlus',
                onSelect: () => doCreate(node.path, 'file'),
            })
            items.push({
                label: 'New Folder',
                icon: 'FolderPlus',
                onSelect: () => doCreate(node.path, 'dir'),
            })
            items.push({
                label: 'New Base',
                icon: 'Database',
                submenu: BASE_VIEW_KINDS.map(v => ({
                    label: v.label,
                    icon: v.icon,
                    onSelect: () => doCreate(node.path, 'base', v.view),
                })),
            })
            items.push({
                label: 'New Spreadsheet',
                icon: 'Table',
                onSelect: () => doCreate(node.path, 'sheet'),
            })
            items.push({
                label: 'New Drawing',
                icon: 'PenTool',
                onSelect: () => doCreate(node.path, 'draw'),
            })
        }
        // The `.settings` config file + the .daemon system folder are runtime-managed: block
        // rename/delete/set-icon so they can't be broken from the tree (the create actions above
        // stay, for hand-adding crons/memory).
        if (!node.isSystemFolder && node.path !== SETTINGS_FILE) {
            items.push({
                label: 'Set Icon…',
                icon: 'Image',
                onSelect: () => setIconPicker({ node, isDir }),
            })
            items.push({
                label: 'Visibility',
                icon: visibilityMenuIcon(node.visibility),
                submenu: buildVisibilitySubmenu(node, isDir),
            })
            items.push({
                label: 'Rename',
                icon: 'Pencil',
                onSelect: () => setEditing(node.path),
            })
            items.push({
                label: 'Delete',
                icon: 'Trash2',
                danger: true,
                separatorBefore: true,
                onSelect: () => doDelete(node),
            })
        }
        return items
    }

    function openMenuFor(node: TreeNode, e: MouseEvent) {
        e.preventDefault()
        e.stopPropagation()
        // Native OS menu in the Tauri build; HTML ContextMenu fallback in the browser.
        openContextMenu(e.clientX, e.clientY, buildMenuItems(node), setMenu)
    }

    /** Move `from` into `targetDir` ("" = vault root). Guards no-op and into-self. Driven by the
     *  shared drag controller: App resolves a sidebar folder/root drop and dispatches
     *  `bismuth-move-into`, keeping all the optimistic-tree machinery (rename + retarget open tab +
     *  revert-on-failure) here where it belongs. This is the on-disk MOVE that Row 73 was missing —
     *  native HTML5 drag never fired the old handler under WKWebView/synthetic pointers. */
    async function moveIntoFrom(from: string, targetDir: string) {
        if (!from) return
        if (parentOf(from) === targetDir) return // already there
        if (targetDir === from || targetDir.startsWith(from + '/')) return // into itself/descendant
        const to = joinPath(targetDir, from.split('/').pop()!)
        optimisticRename(from, to) // instant; reverted via refresh() on failure
        // Keep any open tab pointing at the moved path (incl. files under a moved folder).
        window.dispatchEvent(
            new CustomEvent('bismuth-moved', { detail: { from, to } }),
        )
        if (targetDir) setOpen(prev => new Set(prev).add(targetDir))
        try {
            await trackPending(() => api.move(from, to))
        } catch (e) {
            await refetch()
            pushToast(`Move failed: ${(e as Error).message}`)
        }
    }

    const onMoveInto = (e: Event) => {
        const d = (e as CustomEvent).detail as
            { from?: string; targetDir?: string } | undefined
        if (!d?.from) return
        void moveIntoFrom(d.from, d.targetDir ?? '')
    }
    window.addEventListener('bismuth-move-into', onMoveInto)
    onCleanup(() => window.removeEventListener('bismuth-move-into', onMoveInto))

    // NoteTitle's inline rename (editing the `# heading` at the top of a note, not a tree row) fires
    // this same `bismuth-moved` event but owns none of this file's optimistic-tree machinery, so
    // without a listener here the row stayed at its OLD path until the next SSE-gated refetch landed
    // — `child.path === props.activeFile` (Level, below) matched nothing in between, and the active-
    // file highlight vanished from every row for that whole gap. Re-applying `optimisticRename` here
    // is a harmless no-op for FileTree's OWN move/rename paths above (moveIntoFrom, EditableLabel's
    // commit) — they already called it before dispatching, and renameEntries only rewrites entries
    // still sitting at `from`.
    const onMoved = (e: Event) => {
        const { from, to } = (e as CustomEvent).detail as {
            from: string
            to: string
        }
        optimisticRename(from, to) // instant; the reconciling refetch still lands once settled
    }
    window.addEventListener('bismuth-moved', onMoved)
    onCleanup(() => window.removeEventListener('bismuth-moved', onMoved))

    // ── Keyboard navigation ───────────────────────────────────────────────────────────────────
    // The tree was previously nested <div>s with click handlers and nothing else: three Tab presses
    // from a fresh story landed on BODY, i.e. the vault's primary navigation was unreachable without
    // a mouse. The ONE tab stop is this container (rows are all tabindex=-1); arrows move a roving
    // focus between rows from here, which is the standard tree pattern and keeps Tab from walking
    // every file in the vault.
    //
    // Rows are addressed by `[role=treeitem]` and read back through `data-ft-*`. That is a DOM query
    // from inside a component, which CLAUDE.md normally forbids — but the ban is on matching CLASS
    // names (CSS Modules hash them, so the string silently matches nothing). Role and data
    // attributes are never hashed, and the rule names exactly this as the correct escape hatch when
    // a ref cannot reach. A ref genuinely cannot reach here: the rows are rendered by a recursive
    // <Level> whose depth is unbounded.
    let rootEl: HTMLDivElement | undefined
    const rows = () =>
        rootEl
            ? ([...rootEl.querySelectorAll('[role="treeitem"]')] as HTMLElement[])
            : []
    /** The row focus should land on when focus enters the tree: the open file, else the first row. */
    const entryRow = () => {
        const all = rows()
        return all.find(el => el.dataset.ftPath === props.activeFile) ?? all[0]
    }
    const focusRow = (el: HTMLElement | undefined) => {
        if (!el) return
        el.focus()
        // Keep the focused row on screen — without this, arrowing past the fold moves focus to a row
        // the user cannot see, which reads as the keys having stopped working.
        el.scrollIntoView({ block: 'nearest' })
    }
    const onTreeKeyDown = (e: KeyboardEvent) => {
        // THE RENAME BOX IS INSIDE THIS CONTAINER, so its keystrokes bubble here. Without this
        // guard the `i < 0` branch below read "activeElement is not one of my rows" as "focus is
        // still on the container" — because an <input> in a row is not a row — and moved focus to
        // one. That blurs the input, and the input commits on blur: typing a space in a filename
        // ended the rename mid-word. Space was just the most obvious of the set; Home, End and the
        // arrows were being taken from the caret the same way.
        if (isTypingTarget(e.target)) return
        const all = rows()
        if (!all.length) return
        const active = document.activeElement as HTMLElement | null
        const i = active ? all.indexOf(active) : -1
        // Focus is still on the container itself (the user just tabbed in): every key that means
        // "go somewhere" should first put focus on a real row.
        if (i < 0) {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) {
                e.preventDefault()
                focusRow(entryRow())
            }
            return
        }
        const path = active!.dataset.ftPath
        const isFolder = active!.dataset.ftKind === 'folder'
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                focusRow(all[Math.min(i + 1, all.length - 1)])
                break
            case 'ArrowUp':
                e.preventDefault()
                focusRow(all[Math.max(i - 1, 0)])
                break
            case 'Home':
                e.preventDefault()
                focusRow(all[0])
                break
            case 'End':
                e.preventDefault()
                focusRow(all[all.length - 1])
                break
            case 'ArrowRight':
                // Open a closed folder; step INTO an already-open one. On a file, do nothing rather
                // than swallowing the key.
                if (!isFolder || !path) return
                e.preventDefault()
                if (!open().has(path)) toggle(path)
                else focusRow(all[Math.min(i + 1, all.length - 1)])
                break
            case 'ArrowLeft':
                // Collapse an open folder; otherwise walk out to the parent row.
                if (!path) return
                e.preventDefault()
                if (isFolder && open().has(path)) toggle(path)
                else {
                    const parent = parentOf(path)
                    focusRow(all.find(el => el.dataset.ftPath === parent))
                }
                break
            case 'Enter':
            case ' ':
                // Reuse the row's own click path rather than duplicating open/toggle/selection
                // logic — those handlers already own multi-select, rename guards and system-folder
                // rules, and a second copy here would drift from them.
                e.preventDefault()
                active!.click()
                break
        }
    }

    return (
        <div
            class={styles['ft-root']}
            classList={{
                [styles['drop-target']]: props.dropHighlight() === '',
            }}
            data-drop-root="true"
            ref={el => (rootEl = el)}
            role="tree"
            aria-label="Vault files"
            tabindex="0"
            onKeyDown={onTreeKeyDown}
            onClick={e => {
                if (e.target === e.currentTarget && selected().size > 0)
                    setSelected(new Set<string>())
            }}
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
                onSettled={renameSettle.report}
                selected={selected()}
                onRowClick={onRowClick}
                startItemDrag={props.startItemDrag}
                dropHighlight={props.dropHighlight}
            />
            <Show when={menu()}>
                {m => (
                    <ContextMenu
                        x={m().x}
                        y={m().y}
                        items={m().items}
                        onClose={() => setMenu(null)}
                    />
                )}
            </Show>
            <Show when={iconPicker()}>
                {p => (
                    <IconPicker
                        title={`Set icon — ${p().node.name}`}
                        current={p().node.icon}
                        onPick={name => applyIcon(p().node, p().isDir, name)}
                        onClear={() => applyIcon(p().node, p().isDir, '')}
                        onClose={() => setIconPicker(null)}
                    />
                )}
            </Show>
        </div>
    )
}

/** Inline-editable name. Renders an auto-selected input; Enter commits via move, Escape cancels. */
function EditableLabel(props: {
    node: TreeNode
    isDir: boolean
    setEditing: (p: string | null) => void
    refresh: () => void
    optimisticRename: (from: string, to: string) => void
    trackPending: <T>(fn: () => Promise<T>) => Promise<T>
    awaitCreate: (path: string) => Promise<void>
    onSettled: (createPath: string, finalPath: string) => void
}) {
    let inputRef: HTMLInputElement | undefined
    const initial = props.node.name
    const startPath = props.node.path
    // The input shows the extension-STRIPPED stem (like Obsidian hides `.md`), so the
    // user never sees or has to preserve the `.md`/`.yaml`/`.yml`. The extension is
    // re-applied on commit. Dirs (and any name without a hidden ext) have ext="" and
    // stem === initial. `.slice` (not `.replace`) so a multi-dot name like
    // `notes.v2.md` strips only the trailing `.md`, leaving `notes.v2`.
    const ext = props.isDir ? '' : (initial.match(NOTE_EXT_RE)?.[0] ?? '')
    const stem = ext ? initial.slice(0, initial.length - ext.length) : initial
    // setEditing(null) unmounts the input, which fires blur → a second commit.
    // `done` makes the rename (or cancel) run exactly once.
    let done = false
    // Report this row's resting place EXACTLY once, whichever way the edit ended. A brand-new
    // note's template write is waiting on this (renameSettle, in FileTree above) — it has to fire
    // on the abandon paths too (Escape, empty/unchanged input, a failed move), otherwise a user
    // who keeps "Untitled" would silently get no template at all.
    let reported = false
    const settle = (finalPath: string) => {
        if (reported) return
        reported = true
        props.onSettled(startPath, finalPath)
    }

    const commit = async () => {
        if (done) return
        done = true
        const raw = inputRef?.value.trim() ?? ''
        props.setEditing(null)
        if (!raw || raw === stem) {
            settle(startPath)
            return
        } // no-op (input holds the stem, not the full name)
        // Re-apply the original hidden extension (.md/.yaml/.yml) if the user dropped it.
        const newName =
            ext && !raw.toLowerCase().endsWith(ext.toLowerCase())
                ? `${raw}${ext}`
                : raw
        if (newName === initial) {
            settle(startPath)
            return
        } // typed the exact current name back (e.g. with the ext) → silent no-op, not an EEXIST error
        const from = props.node.path
        const to = joinPath(parentOf(from), newName)
        props.optimisticRename(from, to) // instant; reverted via refresh() on failure
        // Keep any open tab pointing at the renamed path.
        window.dispatchEvent(
            new CustomEvent('bismuth-moved', { detail: { from, to } }),
        )
        try {
            // If this row was just created, its `api.create` may still be in flight —
            // wait for it so the move never races ahead of the file's existence on disk.
            await props.awaitCreate(from)
            await props.trackPending(() => api.move(from, to))
            // Only NOW is the file actually at `to` on disk, so anything waiting to write to it
            // (the new-note template) can go ahead without racing the move.
            settle(to)
        } catch (e) {
            props.refresh()
            pushToast(`Rename failed: ${(e as Error).message}`)
            settle(from) // the move never landed — the note is still at the path it was created at
        }
    }

    const cancel = () => {
        if (done) return
        done = true
        props.setEditing(null)
        settle(startPath)
    }

    // Safety net: if the edit box goes away without either path running (an external
    // setEditing(null), a tree rebuild that drops the row), the row is still on disk at the name
    // it had — report that, so a pending template write can never be stranded forever. `done` is
    // set BEFORE commit()'s own setEditing(null) unmounts us, so this can't pre-empt a commit
    // that is still awaiting its move.
    onCleanup(() => {
        if (!done) settle(startPath)
    })

    return (
        <input
            ref={el => {
                inputRef = el
                // The value is already the extension-stripped stem, so just select it all.
                queueMicrotask(() => {
                    el.focus()
                    el.select()
                })
            }}
            value={stem}
            class={styles['ft-edit-input']}
            onClick={e => e.stopPropagation()}
            // The row starts a drag on POINTERDOWN, not click — stopPropagation on onClick alone
            // doesn't reach it. Stop it here so a press placing the caret can never be read as a
            // row-drag start, instead of the parent DOM-matching a hashed class name to find out.
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') cancel()
            }}
            onBlur={commit}
        />
    )
}

// Smoothly slides a folder's children open/closed via the CSS grid-rows 0fr↔1fr trick
// (animates to content height with no measuring). `mounted` keeps the subtree in the DOM
// through the close animation; `expanded` drives the transition and is flipped a frame
// after mount so the very first open animates from 0 rather than snapping. Solid keeps
// `props.children` lazy, so a never-opened folder's subtree is never built.
function Level(props: {
    node: TreeNode
    depth: number
    open: Set<string>
    toggle: (p: string) => void
    onOpen: (p: string) => void
    activeFile?: string | null
    onMenu: (node: TreeNode, e: MouseEvent) => void
    editing: string | null
    setEditing: (p: string | null) => void
    refresh: () => void
    optimisticRename: (from: string, to: string) => void
    trackPending: <T>(fn: () => Promise<T>) => Promise<T>
    awaitCreate: (path: string) => Promise<void>
    onSettled: (createPath: string, finalPath: string) => void
    selected: Set<string>
    onRowClick: (node: TreeNode, e: MouseEvent) => boolean
    startItemDrag: (
        e: PointerEvent,
        kind: 'note' | 'folder',
        path: string,
        label: string,
    ) => void
    dropHighlight: () => string | null
}) {
    // Begin a pointer-drag of a row (unless it's being renamed or is a protected system node). The
    // native tap (open/toggle/select) stays on the row's onClick; a real drag swallows that click.
    const onRowPointerDown = (
        e: PointerEvent,
        node: TreeNode,
        kind: 'note' | 'folder',
        label: string,
    ) => {
        if (e.button !== 0) return
        if (props.editing === node.path) return
        if (node.isSystemFolder || node.path === SETTINGS_FILE) return
        // The rename input (when open) stops its own pointerdown from reaching here — see its
        // onPointerDown — so a press placing the caret can never be misread as a row-drag start.
        e.stopPropagation() // don't let a nested row's press bubble to an ancestor row
        props.startItemDrag(e, kind, node.path, label)
    }
    // MUST stay a memo, not a captured array. A Solid component body runs ONCE, so a plain
    // `const kids = sortedChildren(props.node)` freezes <For>'s list at whatever the first paint
    // had — every later tree change (a new note, a new folder, a delete) updates files() and
    // treeRoot() but never reaches the DOM, and the sidebar only "catches up" on next launch when
    // it re-seeds from the cached tree. That was github issue #8. Reading kids() inside the JSX
    // keeps `each` a call expression, so Solid wraps it in a getter and the list tracks props.node.
    // <For>'s (item, index) pair still needs the sibling count to know whether a row is the LAST
    // child (picks `|--` vs `` `-- `` in the connector prefix below — bismuth-design/ascii/README.md
    // "Components", ascii-tree.card.html); the connector string itself encodes indentation.
    const kids = createMemo(() => sortedChildren(props.node))
    const prefixFor = (i: number) =>
        treePrefix(props.depth, i === kids().length - 1)
    return (
        <For each={kids()}>
            {(child, i) => {
                return child.children ? (
                    <div>
                        <div
                            class={styles['ft-row']}
                            classList={{
                                [styles['drop-target']]:
                                    props.dropHighlight() === child.path,
                                [styles['system']]: !!child.isSystemFolder,
                                [styles['selected']]: props.selected.has(
                                    child.path,
                                ),
                            }}
                            data-drop-folder={
                                child.isSystemFolder ? undefined : child.path
                            }
                            // Tree semantics. `tabindex=-1` on every row is deliberate: the ONE tab
                            // stop is the `role="tree"` container in FileTree, which moves focus in
                            // here on arrow keys (the standard roving pattern). Per-row tabindex=0
                            // would make Tab walk every file in the vault.
                            // `data-ft-*` rather than a class, because the container reads these
                            // back — CSS Modules hash class names to nothing, so a class-keyed
                            // lookup silently matches zero rows at runtime (CLAUDE.md's documented
                            // trap); attributes are never hashed.
                            role="treeitem"
                            tabindex="-1"
                            aria-expanded={props.open.has(child.path)}
                            aria-selected={props.selected.has(child.path)}
                            data-ft-path={child.path}
                            data-ft-kind="folder"
                            onPointerDown={e =>
                                onRowPointerDown(
                                    e,
                                    child,
                                    'folder',
                                    child.label ?? child.name,
                                )
                            }
                            onClick={e => {
                                if (props.editing === child.path) return
                                if (props.onRowClick(child, e)) return
                                props.toggle(child.path)
                            }}
                            onContextMenu={e => props.onMenu(child, e)}
                        >
                            <span class={styles['ft-prefix']}>
                                {prefixFor(i()).trimEnd()}
                            </span>
                            {/* One glyph, not two: the folder icon's own shape IS the disclosure state (Folder "▸" /
                  FolderOpen "▾" — see icons/registry.ts), so there is no separate chevron icon here.
                  A bare ChevronRight/ChevronDown alongside it drew the same triangle twice. */}
                            <Icon
                                value={child.icon}
                                fallback={
                                    child.isSystemFolder
                                        ? 'Settings2'
                                        : props.open.has(child.path)
                                          ? 'FolderOpen'
                                          : 'Folder'
                                }
                                size={14}
                                class={styles['ft-icon']}
                            />
                            <VisibilityBadge visibility={child.visibility} />
                            <Show
                                when={props.editing === child.path}
                                fallback={child.label ?? child.name}
                            >
                                <EditableLabel
                                    node={child}
                                    isDir={true}
                                    setEditing={props.setEditing}
                                    refresh={props.refresh}
                                    optimisticRename={props.optimisticRename}
                                    trackPending={props.trackPending}
                                    awaitCreate={props.awaitCreate}
                                    onSettled={props.onSettled}
                                />
                            </Show>
                        </div>
                        <Collapsible open={props.open.has(child.path)}>
                            <Level
                                node={child}
                                depth={props.depth + 1}
                                open={props.open}
                                toggle={props.toggle}
                                onOpen={props.onOpen}
                                activeFile={props.activeFile}
                                onMenu={props.onMenu}
                                editing={props.editing}
                                setEditing={props.setEditing}
                                refresh={props.refresh}
                                optimisticRename={props.optimisticRename}
                                trackPending={props.trackPending}
                                awaitCreate={props.awaitCreate}
                                onSettled={props.onSettled}
                                selected={props.selected}
                                onRowClick={props.onRowClick}
                                startItemDrag={props.startItemDrag}
                                dropHighlight={props.dropHighlight}
                            />
                        </Collapsible>
                    </div>
                ) : (
                    <div
                        class={`${styles['ft-row']} file`}
                        classList={{
                            [styles['active']]: child.path === props.activeFile,
                            [styles['system']]: child.path === SETTINGS_FILE,
                            [styles['selected']]: props.selected.has(
                                child.path,
                            ),
                        }}
                        // See the folder row above for why role/tabindex/data-ft-* are shaped this
                        // way. `aria-current` (not just aria-selected) marks the OPEN file: a
                        // screen reader otherwise has no way to tell which note the editor is
                        // showing, since that was previously conveyed by colour alone.
                        role="treeitem"
                        tabindex="-1"
                        aria-selected={props.selected.has(child.path)}
                        aria-current={
                            child.path === props.activeFile ? 'true' : undefined
                        }
                        data-ft-path={child.path}
                        data-ft-kind="file"
                        onPointerDown={e =>
                            onRowPointerDown(
                                e,
                                child,
                                'note',
                                child.label ?? displayName(child.name),
                            )
                        }
                        onClick={e => {
                            if (props.editing === child.path) return
                            if (props.onRowClick(child, e)) return
                            props.onOpen(child.path)
                        }}
                        onContextMenu={e => props.onMenu(child, e)}
                    >
                        <span class={styles['ft-prefix']}>
                            {prefixFor(i()).trimEnd()}
                        </span>
                        <Icon
                            value={child.icon}
                            fallback={
                                child.name.endsWith('.sheet')
                                    ? 'Table'
                                    : 'FileText'
                            }
                            size={14}
                            class={styles['ft-icon']}
                        />
                        <VisibilityBadge visibility={child.visibility} />
                        <Show
                            when={props.editing === child.path}
                            fallback={child.label ?? displayName(child.name)}
                        >
                            <EditableLabel
                                node={child}
                                isDir={false}
                                setEditing={props.setEditing}
                                refresh={props.refresh}
                                optimisticRename={props.optimisticRename}
                                trackPending={props.trackPending}
                                awaitCreate={props.awaitCreate}
                                onSettled={props.onSettled}
                            />
                        </Show>
                    </div>
                )
            }}
        </For>
    )
}
