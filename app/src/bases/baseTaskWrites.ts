// The task write seam BaseView hands down to every row-based view: ONE pair of handlers (toggle
// + status menu) plus the bar's "+ task", deciding by which handle the ROW carries — `note.line`
// (a scanned checkbox line in another note → POST /tasks/toggle) or `row.index` (a row stored in
// the base file's own table → POST /row/update). Every collaborator is INJECTED, so this module
// imports no framework runtime and no `api`, and a test can drive it with fakes.
//
// BOTH HANDLES COME FROM THE ROW, never `editPath()`: `Row.index` is minted next to the
// `file.path` it indexes into, and a `source: base` view holds rows whose index belongs to the
// REFERENCED base. Pairing that index with the open base would overwrite the wrong row. There is
// deliberately no fallback. Per ROW too: a row that fails `canWriteStoredRow` gets no write at all
// (an undefined index serialises to an APPEND on update and `splice(0,1)` on delete).
import type {
    BaseConfig,
    Row,
    ViewConfig,
} from '../../../core/src/bases/types'
import { statusFromChar } from '../../../core/src/taskReorder'
import {
    canWriteStoredRow,
    setStoredTaskStatus,
    toggleStoredTask,
    type StoredTaskWrite,
} from './taskWrite'
import {
    newTaskVisible,
    prospectiveLineTaskRow,
    prospectiveStoredTaskRow,
} from './taskScope'

export type TaskWriteDeps = {
    api: {
        toggleTask: (path: string, line: number, char?: string) => Promise<unknown>
        rowUpdate: (path: string, index: number, note: Record<string, unknown>) => Promise<unknown>
        rowCreate: (path: string, note: Record<string, unknown>) => Promise<unknown>
    }
    appendTaskLine: (file: string, text: string) => Promise<string>
    /** Opens the shared status menu; calls `pick` with the chosen BOX CHAR. */
    openStatusMenu: (x: number, y: number, current: string, pick: (char: string) => void) => void
    toast: (message: string) => void
    refetchAll: () => unknown
    refetchRows: () => unknown
    today: () => string
    editPath: () => string | undefined
    config: () => BaseConfig | undefined
    view: () => ViewConfig | undefined
    ownsRows: () => boolean
    /** Rows currently loaded — only seeds the prospective row's index for the scope check. */
    rowCount: () => number
}

export type TaskWrites = {
    toggleTaskRow: (row: Row, e: Event) => void
    setTaskRowStatus: (row: Row, e: MouseEvent) => void
    addTask: () => Promise<void>
    writeFailed: (what: string) => (err: unknown) => void
}

export function storedTarget(row: Row): { path: string; index: number } | null {
    const path = row.file.path
    const index = row.index
    if (!path || index === undefined || !canWriteStoredRow(row)) return null
    return { path, index }
}

export function createTaskWrites(deps: TaskWriteDeps): TaskWrites {
    // A rejected write must be LEGIBLE: `httpTransport` throws on `!res.ok`, and an unhandled
    // rejection is a checkbox that flicks back with no explanation.
    const writeFailed = (what: string) => (err: unknown) =>
        deps.toast(`Could not ${what}: ${err instanceof Error ? err.message : String(err)}`)

    // Rewrite the row, then APPEND a spawned recurrence if the write produced one (appended, not
    // inserted: a base's rows carry their own sort, and `rowCreate` has no insert-at-index).
    const writeStored = (target: { path: string; index: number }, write: StoredTaskWrite) => {
        void deps.api
            .rowUpdate(target.path, target.index, write.note)
            .then(() => (write.next ? deps.api.rowCreate(target.path, write.next) : undefined))
            .catch(writeFailed('save the task'))
            .finally(() => void deps.refetchAll())
    }

    // A task LINE lives in ANOTHER note, so the base file is untouched and its parse is still
    // good — rows alone. The stored branch writes the base file itself and keeps the document
    // refetch (an own-rows view reads its rows OUT of the document).
    const toggleTaskRow = (row: Row, e: Event) => {
        e.stopPropagation()
        const line = row.note.line
        if (typeof line === 'number') {
            void deps.api
                .toggleTask(row.file.path, line)
                .catch(writeFailed('save the task'))
                .finally(() => void deps.refetchRows())
            return
        }
        const target = storedTarget(row)
        if (!target) return
        writeStored(target, toggleStoredTask(row, deps.today()))
    }

    // The menu hands back a BOX CHAR; `setStoredTaskStatus` takes a status NAME, bridged by
    // `statusFromChar` (core/src/taskReorder — core/src/tasks would drag `node:fs` into the WebView).
    const setTaskRowStatus = (row: Row, e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation() // don't also open the pane's context menu underneath
        const cur = String(row.note.statusChar ?? ' ') || ' '
        const line = row.note.line
        if (typeof line === 'number') {
            deps.openStatusMenu(e.clientX, e.clientY, cur, char => {
                void deps.api
                    .toggleTask(row.file.path, line, char)
                    .catch(writeFailed('set the status'))
                    .finally(() => void deps.refetchRows())
            })
            return
        }
        const target = storedTarget(row)
        if (!target) return
        deps.openStatusMenu(e.clientX, e.clientY, cur, char =>
            writeStored(target, setStoredTaskStatus(row, statusFromChar(char), deps.today())),
        )
    }

    // "+ task" writes to the destination the view's ORIGIN names: a self-owned base gets a ROW,
    // a sourced one a checkbox LINE appended to its declared `taskFile`. A sourced view naming
    // no `taskFile` has nowhere to write and does nothing rather than guess a file.
    const addTask = async () => {
        const path = deps.editPath()
        const cfg = deps.config()
        const view = deps.view()
        let prospective: Row | null = null
        let dest = ''
        let wroteBaseFile = false
        if (deps.ownsRows()) {
            if (!path) return
            const note = { description: 'New task', status: 'todo' }
            dest = path
            prospective = prospectiveStoredTaskRow(path, note, deps.rowCount())
            await deps.api.rowCreate(path, note)
            wroteBaseFile = true
        } else {
            const file = view?.taskFile
            if (!file) return
            dest = await deps.appendTaskLine(file, 'New task')
            prospective = prospectiveLineTaskRow(dest, 'New task')
        }
        // The write happened; this only says where it went. A task that cannot match this
        // view's filters is invisible HERE, not lost — name the file it landed in.
        if (cfg && prospective && !newTaskVisible(cfg, prospective))
            deps.toast(
                `Added to ${dest} — it does not match this view's filters, so it will not appear here`,
            )
        if (wroteBaseFile) await deps.refetchAll()
        else await deps.refetchRows()
    }

    return { toggleTaskRow, setTaskRowStatus, addTask, writeFailed }
}
