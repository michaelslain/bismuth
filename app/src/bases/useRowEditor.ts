// The row-editor gate every row view (Table/List/Bullets/Cards/Map) used to copy-paste: which
// rows can be edited, and how to open the editor on one. Not a component, so props arrive as
// accessors and are read at call time — never destructure them.
//
// `openRowEditor.tsx` is imported lazily inside `open`: a static import would drag a .tsx file
// into this module's graph, and `bun test app/` (the gate's cwd) cannot resolve the JSX runtime
// for one — docs/contributing/testing.md "cwd-dependent JSX-resolution trap".
//
// Final signature:
//   useRowEditor(props: { config, view, columns?, onChanged?, siblingValues? }): { editable, open }
import type { BaseConfig, Row, ViewConfig } from '../../../core/src/bases/types'
import { isStoredPlaceholder } from './taskWrite'

export type RowEditorProps = {
    config: () => BaseConfig
    view: () => ViewConfig
    /** The columns THIS view actually shows (`ViewResult.columns`). */
    columns?: () => string[] | undefined
    onChanged?: () => void
    /** Other rows' values for an array column (`openRowEditor`'s `siblingValues`), so a tags
     *  dropdown in the editor is filled from the view's rows. Omitted by a view with none. */
    siblingValues?: (id: string) => unknown[]
}

export type RowEditor = {
    /** False for a task-line row (a checkbox in a note, edited by its own task editor) and for
     *  a pending placeholder (an optimistic add with no handle to write to yet). */
    editable: (row: Row) => boolean
    open: (row: Row, focusTarget?: string) => void
}

export function useRowEditor(props: RowEditorProps): RowEditor {
    const editable = (row: Row): boolean =>
        typeof row.note.line !== 'number' && !isStoredPlaceholder(row)
    return {
        editable,
        open: (row, focusTarget) => {
            if (!editable(row)) return
            const opts = {
                row,
                config: props.config(),
                view: props.view(),
                columns: props.columns?.(),
                onChanged: props.onChanged,
                siblingValues: props.siblingValues,
                focusTarget,
            }
            void import('./openRowEditor').then(m => m.openRowEditor(opts))
        },
    }
}
