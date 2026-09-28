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

/** Resolve a path against `taken` by appending " 2", " 3", … before the extension. */
function dedupe(desired: string, taken: (path: string) => boolean): string {
    if (!taken(desired)) return desired
    const stem = desired.replace(/\.md$/, '')
    for (let n = 2; ; n++) {
        const cand = `${stem} ${n}.md`
        if (!taken(cand)) return cand
    }
}

async function addOwnedRow(props: AddRowActionProps): Promise<void> {
    const basePath = props.basePath
    if (!basePath) return
    const front = declaredDefaults(props.config)
    // Filter check mirrors BaseView's addTask: report, never prevent — the write happens
    // either way. `index: 0` is a stand-in (passesFilter/toContext read note/file, not the
    // write-back handle), not a claim about where the row will really land.
    const prospective: Row = {
        file: { ...placeholderFile('', basePath) },
        note: front,
        formula: {},
        index: 0,
    }
    try {
        await api.rowCreate(basePath, front)
        props.onAdded()
        if (!newTaskVisible(props.config, props.view, prospective))
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
    const front = declaredDefaults(props.config)
    const name = safeFilename('Untitled')
    // Same folder fallback as KanbanView's `boardFolder()` for a source with no rows yet
    // (no `result` prop here to read an existing row's own folder from): the base's own
    // directory, or — for a base file at the vault root — a folder named after it.
    const folder = parentOf(basePath) || basePath.replace(/\.md$/, '')
    const desired = joinPath(folder, `${name}.md`)
    const path = dedupe(desired, p => p === basePath)
    const content = `---\n${yamlStringify(front)}---\n`
    const prospective: Row = {
        file: placeholderFile(name, path),
        note: front,
        formula: {},
    }
    try {
        await api.write(path, content)
        props.onAdded()
        if (!newTaskVisible(props.config, props.view, prospective))
            pushToast(
                `Added ${path} — it does not match this view's filters, so it will not appear here`,
            )
        openRowEditor({
            row: prospective,
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
