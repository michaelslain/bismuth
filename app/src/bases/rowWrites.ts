// The write paths for ONE row of a base, shared by every row view and the row editor modal.
// Moved out of openRowEditor.tsx (+ AddRowAction's createRow) so a view imports a writer, not a
// modal opener. Two targets, split by `canWriteStoredRow`: a row stored in the base's own body
// writes by INDEX (`api.rowUpdate`/`rowDelete`); a note row writes via `setProperty`/`move`/`del`,
// same as FileTree. Mirrors KanbanView's renameCard/setMetaProperty/deleteCard.
//
// Final signatures (existing parameter shapes kept, so no call site changed):
//   safeFilename(title: string): string
//   commitRename(row, view: ViewConfig, newTitle: string, onChanged?): Promise<string | undefined>
//   commitMeta(row, id: string, value: unknown, onChanged?): Promise<void>
//   commitDelete(row, onChanged?): Promise<() => Promise<void>>   // the UNDO; a failed delete
//                                                                 // toasts and returns a no-op
//   createRow(opts: CreateRowOptions): Promise<Row>
//   RowWriteCtx = { config, basePath?, onChanged? } — the shared base of CreateRowOptions
// Every delete is immediate and pushes an undo toast; the returned undo is the same action.
import { stringify as yamlStringify } from 'yaml'
import type { BaseConfig, ViewConfig, Row } from '../../../core/src/bases/types'
import { placeholderFile } from '../../../core/src/bases/types'
import { declaredDefaults } from '../../../core/src/bases/properties'
import { fileBasename } from '../../../core/src/pathUtils'
import { canWriteStoredRow, storedNote } from './taskWrite'
import { storedTitleColumn, writableKey } from './kanbanMeta'
import { parentOf, joinPath } from '../fileTreeOps'
import { flushEditorsAtOrUnder, flushSidecarsAtOrUnder } from '../editorRegistry'
import { api } from '../api'
import { pushToast } from '../toastStore'

export type RowWriteCtx = {
    config: BaseConfig
    basePath?: string
    onChanged?: () => void
}

/** Make a title safe as a filename: strip path/YAML-hostile chars, collapse whitespace. */
export function safeFilename(title: string): string {
    const s = title
        .replace(/[\\/:*?"<>|#[\]]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim()
    return s.slice(0, 120) || 'Untitled'
}

/** Returns the row's note path AFTER a successful rename (or the unchanged path when nothing
 *  moved), or `undefined` on failure — so a caller racing `[open note]` against a pending
 *  rename can wait on the real destination instead of dispatching the stale old path. */
export async function commitRename(
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
 *  view's inline/modal editors. Owned rows write by index (the whole stored note, minus derived
 *  keys); note rows write/clear the frontmatter key directly.
 *
 *  Skips the write entirely when the normalized next value already matches what is stored, so
 *  an Escape that reverts a draft back to its original value does not round-trip an identical
 *  write to the server. */
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

/** Delete this row at once and offer an undo toast. A stored row goes by index (undo re-creates
 *  it); a note row goes to the trash after flushing any pending editor/sidecar write (undo
 *  restores it). Returns the undo, so a caller can offer its own affordance; on failure it
 *  toasts and returns a no-op. */
export async function commitDelete(
    row: Row,
    onChanged?: () => void,
    /** Names a STORED row in the toast (`Deleted "<title>"`); default `Deleted row`. */
    title?: string,
): Promise<() => Promise<void>> {
    const path = row.file.path
    const fail = (e: unknown): (() => Promise<void>) => {
        pushToast(`Delete failed: ${(e as Error).message}`)
        return async () => {}
    }
    let undo: () => Promise<void>
    let message: string
    if (canWriteStoredRow(row)) {
        const index = row.index!
        const note = storedNote(row)
        try {
            await api.rowDelete(path, index)
        } catch (e) {
            return fail(e)
        }
        undo = async () => {
            await api.rowCreate(path, note)
            onChanged?.()
        }
        message = title === undefined ? 'Deleted row' : `Deleted "${title}"`
    } else {
        const name = row.file.name
        let trashPath: string
        try {
            await Promise.all([
                flushEditorsAtOrUnder(path),
                flushSidecarsAtOrUnder(path),
            ])
            trashPath = (await api.del(path)).trashPath
        } catch (e) {
            return fail(e)
        }
        undo = async () => {
            await api.restore(trashPath, path)
            onChanged?.()
        }
        message = `Deleted "${name}"`
    }
    onChanged?.()
    pushToast(message, {
        label: 'Undo',
        onClick: () =>
            void undo().catch((e: unknown) =>
                pushToast(`Restore failed: ${(e as Error).message}`),
            ),
    })
    return undo
}

/** Where a new NOTE row lands when the caller names no folder: the base's own directory, or —
 *  for a base file at the vault root — a folder named after it. Same fallback as KanbanView's
 *  `boardFolder()` for a source with no rows yet. */
function defaultFolder(basePath: string): string {
    return parentOf(basePath) || basePath.replace(/\.md$/, '')
}

/** Write `contents` to the first free `<folder>/<name>[ N].md`. `writeChecked` against an empty
 *  base text only succeeds when nothing is there yet, so a second `Untitled` never overwrites the
 *  first. */
async function writeFreshNote(
    folder: string,
    name: string,
    contents: string,
): Promise<string> {
    for (let n = 1; n < 500; n++) {
        const path = joinPath(folder, n === 1 ? `${name}.md` : `${name} ${n}.md`)
        const res = await api.writeChecked(path, contents, '')
        if (!res.conflict) return path
    }
    throw new Error(`no free name for ${name} in ${folder || 'the vault root'}`)
}

export type CreateRowOptions = RowWriteCtx & {
    basePath: string
    /** True when the base owns its rows (no `source:` — a new row is a row in the base file's own
     *  body, not a note). */
    ownsRows: boolean
    /** Extra properties merged over the base's declared defaults — a map pin's lat/lng. */
    note?: Record<string, unknown>
    /** Folder a new NOTE row is written into (ignored for owned rows). Defaults to the base's
     *  own folder; a caller that knows where its rows live (MapView, from an existing row)
     *  passes that, so the new note lands beside its siblings. */
    folder?: string
}

/** Create ONE row — the single create path behind the bar's `[+]` and the map's `Add pin`.
 *  An owned row is appended to the base file's own table; a note row is a new `Untitled` note.
 *  Returns the prospective Row (a note row's real path; an owned row's `index` is unknown until
 *  a refetch, so it is left unset). Throws on failure — the caller owns the toast. */
export async function createRow(opts: CreateRowOptions): Promise<Row> {
    const front = { ...declaredDefaults(opts.config), ...(opts.note ?? {}) }
    if (opts.ownsRows) {
        await api.rowCreate(opts.basePath, front)
        return {
            file: { ...placeholderFile('', opts.basePath) },
            note: front,
            formula: {},
        }
    }
    const name = safeFilename('Untitled')
    const path = await writeFreshNote(
        opts.folder ?? defaultFolder(opts.basePath),
        name,
        `---\n${yamlStringify(front)}---\n`,
    )
    return { file: placeholderFile(fileBasename(path), path), note: front, formula: {} }
}
