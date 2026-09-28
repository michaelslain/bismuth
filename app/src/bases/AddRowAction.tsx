// A bar action that creates a new row in a table/list/bullets/cards view — the "+ row" analogue
// of BaseView's own AddTaskAction (which covers `mode: tasks`; this covers `mode: normal`). Wired
// by BaseView (see openRowEditor.tsx's report for the exact call-site prop additions needed).
import { Show } from 'solid-js'
import { stringify as yamlStringify } from 'yaml'
import type { BaseConfig, ViewConfig, Row } from '../../../core/src/bases/types'
import { placeholderFile } from '../../../core/src/bases/types'
import { declaredDefaults } from '../../../core/src/bases/properties'
import { newTaskVisible } from './taskScope'
import { safeFilename, openRowEditor } from './openRowEditor'
import { parentOf, joinPath } from '../fileTreeOps'
import { fileBasename } from '../../../core/src/pathUtils'
import { api } from '../api'
import { pushToast } from '../Toast'
import IconButton from '../ui/IconButton'

export type AddRowActionProps = {
    basePath?: string
    config: BaseConfig
    view: ViewConfig
    viewIndex: number
    /** True when the base owns its rows (no `source:` — see BaseView's `ownsRows`): a new
     *  row is a row in the base file's own body, not a note. */
    ownsRows: boolean
    mode: 'normal' | 'tasks'
    /** Refetch after the row lands — BaseView's `refetchAll`. */
    onAdded: () => void
}

/** Where a new NOTE row lands when the caller names no folder: the base's own directory, or —
 *  for a base file at the vault root — a folder named after it. Same fallback as KanbanView's
 *  `boardFolder()` for a source with no rows yet. */
function defaultFolder(basePath: string): string {
    return parentOf(basePath) || basePath.replace(/\.md$/, '')
}

/** Write `contents` to the first free `<folder>/<name>[ N].md`. `writeChecked` against an empty
 *  base text only succeeds when nothing is there yet, so a second `Untitled` never overwrites the
 *  first (a plain `api.write` did — adding two rows without renaming the first lost it). */
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

export type CreateRowOptions = {
    basePath: string
    config: BaseConfig
    /** True when the base owns its rows (see AddRowActionProps.ownsRows). */
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

async function addOwnedRow(props: AddRowActionProps): Promise<void> {
    const basePath = props.basePath
    if (!basePath) return
    // Filter check mirrors BaseView's addTask: report, never prevent — the write happens
    // either way. `index: 0` is a stand-in (passesFilter/toContext read note/file, not the
    // write-back handle), not a claim about where the row will really land.
    try {
        const row = await createRow({ basePath, config: props.config, ownsRows: true })
        props.onAdded()
        if (!newTaskVisible(props.config, props.view, { ...row, index: 0 }))
            pushToast(
                `Added to ${basePath} — it does not match this view's filters, so it will not appear here`,
            )
        else pushToast('Row added — click it to fill in its properties')
    } catch (e) {
        pushToast(`Add row failed: ${(e as Error).message}`)
    }
}

async function addNoteRow(props: AddRowActionProps): Promise<void> {
    const basePath = props.basePath
    if (!basePath) return
    try {
        const row = await createRow({ basePath, config: props.config, ownsRows: false })
        props.onAdded()
        if (!newTaskVisible(props.config, props.view, row))
            pushToast(
                `Added ${row.file.path} — it does not match this view's filters, so it will not appear here`,
            )
        openRowEditor({
            row,
            config: props.config,
            view: props.view,
            onChanged: props.onAdded,
        })
    } catch (e) {
        pushToast(`Add row failed: ${(e as Error).message}`)
    }
}

const AddRowAction = (props: AddRowActionProps) => (
    <Show
        when={
            props.mode === 'normal' &&
            (props.view.type === 'table' ||
                props.view.type === 'list' ||
                props.view.type === 'bullets' ||
                props.view.type === 'cards') &&
            !!props.basePath
        }
    >
        <IconButton
            icon="Plus"
            label="New row"
            onClick={() =>
                void (props.ownsRows ? addOwnedRow(props) : addNoteRow(props))
            }
        />
    </Show>
)

export default AddRowAction
