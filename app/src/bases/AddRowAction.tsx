// A bar action that creates a new row in a table/list/bullets/cards view — the "+ row" analogue
// of BaseView's own AddTaskAction (which covers `mode: tasks`; this covers `mode: normal`). Wired
// by BaseView (see openRowEditor.tsx's report for the exact call-site prop additions needed).
import { Show } from 'solid-js'
import type { BaseConfig, ViewConfig } from '../../../core/src/bases/types'
import { newTaskVisible } from './taskScope'
import { openRowEditor } from './openRowEditor'
import { createRow } from './rowWrites'
import { pushToast } from '../toastStore'
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

// MapView still imports `createRow` from here; its wave-2 owner repoints it at ./rowWrites.
export { createRow } from './rowWrites'

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
