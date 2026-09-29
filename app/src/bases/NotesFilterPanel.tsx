import { Show, createMemo, type Component } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { TextInput } from '../ui/TextInput'
import SettingsField from '../ui/SettingsField'
import FiltersEditor from './FiltersEditor'
import { formToNotes, notesToForm, type NotesFilter } from './notesFilterForm'

export type NotesFilterPanelProps = {
    value: NotesFilter
    /** The edited connective + rows (and `rawWhere`, when that is what changed). */
    onChange: (next: Partial<NotesFilter>) => void
    /** Property ids the condition picker offers. */
    properties: string[]
    /** Sample rows for type inference and the tag / folder pickers. */
    rows: Row[]
    class?: string
}

/**
 * The query builder's Notes filter: the shared FiltersEditor over the builder's rows, or — when
 * the block carries a whole expression the builder could not reverse into rows — that
 * expression in one field, kept verbatim until it is cleared.
 */
const NotesFilterPanel: Component<NotesFilterPanelProps> = props => {
    const form = createMemo(() => notesToForm(props.value))
    return (
        <Show
            when={props.value.rawWhere}
            fallback={
                <FiltersEditor
                    class={props.class}
                    value={form()}
                    onChange={f => props.onChange(formToNotes(f))}
                    properties={props.properties}
                    rows={props.rows}
                />
            }
        >
            <SettingsField
                label="advanced expression"
                hint="this query uses an expression the visual editor can't reverse. editing it here keeps it verbatim; clear it to build filters visually."
            >
                <TextInput
                    value={props.value.rawWhere ?? ''}
                    multiline
                    onInput={rawWhere => props.onChange({ rawWhere })}
                />
            </SettingsField>
        </Show>
    )
}

export default NotesFilterPanel
