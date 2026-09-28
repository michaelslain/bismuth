// Imperative opener for <CardEditModal> from a view that has no per-card component of its
// own (TableView/ListView/BulletsView/CardsView) — the pattern is app/src/taskStatusMenu.tsx's
// `openTaskStatusMenu`: mount the shared modal into a detached host node, dispose on close.
//
// KanbanCard/KanbanView own the ORIGINAL wiring (rename/meta/delete) for a card inside a board;
// this module re-derives the same three write paths for a bare Row that isn't sitting inside a
// KanbanView — same two-target split (`canWriteStoredRow`: a row stored in the base's own body
// writes by INDEX via `api.rowUpdate`/`rowDelete`; a note row writes via `setProperty`/`move`/
// `del`, same as FileTree). See taskWrite.ts / KanbanView.tsx's renameCard/setMetaProperty/
// deleteCard for the originals this mirrors.
import { render } from 'solid-js/web'
import type { Row, BaseConfig, ViewConfig } from '../../../core/src/bases/types'
import { CardEditModal } from './CardEditModal'
import { canWriteStoredRow, isStoredPlaceholder, storedNote } from './taskWrite'
import { storedTitleColumn, metaColumns, writableKey } from './kanbanMeta'
import { parentOf } from '../fileTreeOps'
import {
    flushEditorsAtOrUnder,
    flushSidecarsAtOrUnder,
} from '../editorRegistry'
import { api } from '../api'
import { pushToast } from '../Toast'

/** Make a title safe as a filename: strip path/YAML-hostile chars, collapse whitespace.
 *  Copy of KanbanView's private `safeFilename` (not exported there) — exported here so
 *  AddRowAction can reuse it for note-source creation without a second implementation. */
export function safeFilename(title: string): string {
    const s = title
        .replace(/[\\/:*?"<>|#[\]]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim()
    return s.slice(0, 120) || 'Untitled'
}

/** The `order:`/declared-property id list to show as editable meta on a bare row — mirrors
 *  `metaSource`'s declared-properties fallback (kanbanMeta.ts) minus the `groupBy` exclusion,
 *  which has no meaning outside a kanban board's grouped columns. An explicit view `order:`
 *  always wins; otherwise a base that declares its own properties shows those. */
function fallbackOrder(config: BaseConfig, view: ViewConfig): string[] {
    if (view.order && view.order.length) return view.order
    if (config.declaredProperties && config.declaredProperties.length)
        return config.declaredProperties
    return []
}

/** Returns the row's note path AFTER a successful rename (or the unchanged path when nothing
 *  moved), or `undefined` on failure — so a caller racing `[open note]` against a pending
 *  rename can wait on the real destination instead of dispatching the stale old path. */
async function commitRename(
    row: Row,
    view: ViewConfig,
    newTitle: string,
    onChanged?: () => void,
): Promise<string | undefined> {
    const t = newTitle.trim()
    if (!t) return row.file.path
    if (canWriteStoredRow(row)) {
        const key = writableKey(storedTitleColumn(view.order ?? []))
        if (key === null) return row.file.path
        const note = { ...storedNote(row), [key]: t }
        try {
            await api.rowUpdate(row.file.path, row.index!, note)
            onChanged?.()
            return row.file.path
        } catch (e) {
            pushToast(`Rename failed: ${(e as Error).message}`)
            return undefined
        }
    }
    if (t === row.file.name) return row.file.path
    const dir = parentOf(row.file.path)
    const desired = `${dir ? dir + '/' : ''}${safeFilename(t)}.md`
    if (desired === row.file.path) return row.file.path
    try {
        await api.move(row.file.path, desired)
        onChanged?.()
        return desired
    } catch (e) {
        pushToast(`Rename failed: ${(e as Error).message}`)
        return undefined
    }
}

/** Commit a single property's value for `row` — the ONE write helper shared by every row
 *  view's inline/modal editors (TableView's per-cell editor, ListView/BulletsView/CardsView's
 *  openRowEditor modal, KanbanCard's meta chips). Owned rows write by index (the whole stored
 *  note, minus derived keys); note rows write/clear the frontmatter key directly.
 *
 *  Skips the write entirely when the normalized next value already matches what is stored —
 *  same no-op guard KanbanCard's own `commitMeta` applies — so an Escape that reverts a draft
 *  back to its original value (PropertyValueEditor's dismiss path still blurs, which still
 *  commits) does not round-trip an identical write to the server. */
export async function commitMeta(
    row: Row,
    id: string,
    value: unknown,
    onChanged?: () => void,
): Promise<void> {
    const key = writableKey(id)
    if (key === null) return
    const current = (row.note as Record<string, unknown>)[key] ?? null
    const next =
        value === null || value === undefined || value === '' ? null : value
    if (JSON.stringify(next) === JSON.stringify(current)) return // unchanged — no write
    try {
        if (canWriteStoredRow(row)) {
            const note = { ...storedNote(row) }
            if (next === null) delete note[key]
            else note[key] = next
            await api.rowUpdate(row.file.path, row.index!, note)
        } else if (next === null) {
            await api.deleteProperty(row.file.path, key)
        } else {
            await api.setProperty(row.file.path, key, next)
        }
        onChanged?.()
    } catch (e) {
        pushToast(`Save failed: ${(e as Error).message}`)
    }
}

/** Delete this row — a stored row by index (undo re-creates it, same as KanbanView's
 *  restoreStoredCard), a note row via trash + undo (mirrors FileTree.doDelete /
 *  KanbanView.deleteCard, including flushing any pending editor/sidecar write first). */
export async function commitDelete(
    row: Row,
    onChanged?: () => void,
): Promise<void> {
    if (canWriteStoredRow(row)) {
        const path = row.file.path
        const index = row.index!
        const note = storedNote(row)
        try {
            await api.rowDelete(path, index)
            onChanged?.()
            pushToast('Deleted row', {
                label: 'Undo',
                onClick: () =>
                    void api
                        .rowCreate(path, note)
                        .then(() => onChanged?.())
                        .catch((e: unknown) =>
                            pushToast(
                                `Restore failed: ${(e as Error).message}`,
                            ),
                        ),
            })
        } catch (e) {
            pushToast(`Delete failed: ${(e as Error).message}`)
        }
        return
    }
    const path = row.file.path
    const name = row.file.name
    try {
        await Promise.all([
            flushEditorsAtOrUnder(path),
            flushSidecarsAtOrUnder(path),
        ])
        const { trashPath } = await api.del(path)
        onChanged?.()
        pushToast(`Deleted "${name}"`, {
            label: 'Undo',
            onClick: () =>
                void api
                    .restore(trashPath, path)
                    .then(() => onChanged?.())
                    .catch((e: unknown) =>
                        pushToast(`Restore failed: ${(e as Error).message}`),
                    ),
        })
    } catch (e) {
        pushToast(`Delete failed: ${(e as Error).message}`)
    }
}

/**
 * Imperatively mount <CardEditModal> for `row` — for TableView/ListView/BulletsView/CardsView,
 * none of which host a per-row component (unlike KanbanCard). Self-disposing: closes on save/
 * Escape/outside-click via FormModal, then removes its host node.
 *
 * A `row.index` a caller cannot yet write to (KanbanView's negative optimistic-add sentinel —
 * `isStoredPlaceholder`) is refused: there is nothing real to edit yet.
 */
export function openRowEditor(opts: {
    row: Row
    config: BaseConfig
    view: ViewConfig
    onChanged?: () => void
    focusTarget?: string
    /** The columns THIS view actually shows (`ViewResult.columns`) — when given, these are
     *  what the modal lists instead of re-deriving `fallbackOrder`, so the editor never shows
     *  fewer (or different) properties than the row view it was opened from. Falls back to
     *  `fallbackOrder` when omitted, matching the pre-existing behaviour. */
    columns?: string[]
    /** Every OTHER row's raw value for a property id, restricted by the caller to ARRAY-valued
     *  ones (a tags column's dropdown; see TableView's `arraySiblingsFor`) — feeds the same
     *  fallback KanbanCard's `siblingValues` does. Omitted by a caller with no board of rows
     *  to scan (AddRowAction's freshly-created row, ListView/BulletsView/CardsView today),
     *  which keeps their type-aware editors working, just without that dropdown fill-in. */
    siblingValues?: (id: string) => unknown[]
}): void {
    const { row, config, view, onChanged, focusTarget, columns, siblingValues } = opts
    if (isStoredPlaceholder(row) || typeof row.note.line === 'number') return
    const owned = canWriteStoredRow(row)
    const titleCol = owned ? storedTitleColumn(view.order ?? []) : 'file.name'
    const metaCols = metaColumns(
        columns && columns.length ? columns : fallbackOrder(config, view),
        titleCol,
    )

    const host = document.createElement('div')
    document.body.appendChild(host)
    let dispose = () => {}
    const close = () => {
        dispose()
        host.remove()
    }
    // Every write this modal makes goes through ONE queue, against the row AS THIS MODAL HAS
    // WRITTEN IT (`current`) — never the row it was opened with. Otherwise a second rename moves
    // a path that no longer exists (A→B, then B→C ran `move(A, C)`), a rename back to the original
    // name is skipped while the file sits elsewhere, and a stored row's second property edit
    // rewrites the whole stored note from the opening snapshot, undoing the first. `[open note]`
    // and delete wait on the queue, so they always see the latest path.
    let current: Row = row
    let queue: Promise<unknown> = Promise.resolve()
    const enqueue = (step: (r: Row) => Promise<Row>): Promise<Row> => {
        const next = queue.then(() => step(current)).then(r => (current = r))
        queue = next.catch(() => {})
        return next
    }
    const titleKey = owned ? writableKey(titleCol) : null
    const titleOf = (r: Row): string =>
        owned
            ? String((titleKey && (r.note as Record<string, unknown>)[titleKey]) ?? '')
            : r.file.name
    dispose = render(
        () =>
            CardEditModal({
                row,
                titleCol,
                metaCols,
                config,
                focusTarget,
                // See `siblingValues` above — a caller with no board to scan (no rows param)
                // falls back to `[]`, same as before this option existed.
                siblingValues: siblingValues ?? (() => []),
                hasFileIdentity: true,
                heading: 'edit row',
                emptyHint: 'this row has no editable properties.',
                // The modal commits its title on Enter (blur) AND again on close; against the
                // live row the second is a no-op, so a title that did not change never moves.
                onRename: t =>
                    void enqueue(async r => {
                        const title = t.trim()
                        if (!title || title === titleOf(r)) return r
                        const path = await commitRename(r, view, title, onChanged)
                        if (path === undefined) return r // failed — toasted; nothing moved
                        if (owned)
                            return titleKey
                                ? { ...r, note: { ...r.note, [titleKey]: title } }
                                : r
                        if (path === r.file.path) return r
                        const name =
                            path.split('/').pop()?.replace(/\.md$/, '') ?? r.file.name
                        return { ...r, file: { ...r.file, path, name, basename: name } }
                    }),
                onSetMeta: (id, v) =>
                    void enqueue(async r => {
                        await commitMeta(r, id, v, onChanged)
                        const key = writableKey(id)
                        if (key === null) return r
                        const note = { ...(r.note as Record<string, unknown>) }
                        if (v === null || v === undefined || v === '') delete note[key]
                        else note[key] = v
                        return { ...r, note: note as Row['note'] }
                    }),
                onDelete: () => {
                    close()
                    void enqueue(async r => {
                        await commitDelete(r, onChanged)
                        return r
                    })
                },
                onClose: close,
                onOpenNote: owned
                    ? undefined
                    : () =>
                          void enqueue(async r => {
                              window.dispatchEvent(
                                  new CustomEvent('bismuth-open', {
                                      detail: { path: r.file.path },
                                  }),
                              )
                              return r
                          }),
            }),
        host,
    )
}
