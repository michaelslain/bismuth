import { Index, Show, createMemo, type Component, type JSX } from 'solid-js'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import Text from '../ui/Text'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import { IconTextButton } from '../ui/IconTextButton'
import FilterConditionRow from './FilterConditionRow'
import EditableRows from './EditableRows'
import { FILE_PSEUDO, inferType } from './filterOps'
import {
    addRow,
    condRow,
    patchRow,
    rawRow,
    removeRow,
    setConj,
    toRawRow,
    type FilterForm,
} from './filterForm'
import styles from './FiltersEditor.module.css'

export type FiltersEditorProps = {
    value: FilterForm
    onChange: (form: FilterForm) => void
    /** Property ids the condition picker offers (file.* pseudo-props are added here). */
    properties: string[]
    /** Sample rows — type inference and tag/folder pickers. */
    rows: Row[]
    config?: BaseConfig
    /** Shown when there are no conditions. */
    emptyHint?: JSX.Element
    class?: string
}

/**
 * A list of filter conditions joined by one "match all / any" switch — the no-code editor for
 * a base's or a view's `filters:` and for a source's `where:`. Each condition is a
 * FilterConditionRow; anything the visual pickers can't model shows as a raw expression row
 * and is written back exactly as it was unless edited (see filterForm.ts).
 */
const FiltersEditor: Component<FiltersEditorProps> = props => {
    const properties = createMemo(() => {
        const out = [...props.properties]
        for (const p of FILE_PSEUDO) if (!out.includes(p.id)) out.push(p.id)
        return out
    })

    const addCondition = () => {
        const prop = properties()[0] ?? 'tags'
        props.onChange(
            addRow(props.value, condRow(prop, inferType(prop, props.rows))),
        )
    }

    return (
        <div class={`${styles.editor} ${props.class ?? ''}`}>
            <Show when={props.value.rows.length > 1}>
                <div class={styles.conj}>
                    <Text as="span" size="ui" tone="muted">
                        match
                    </Text>
                    <SegmentedToggle
                        options={[
                            { id: 'and', label: 'all' },
                            { id: 'or', label: 'any' },
                        ]}
                        value={props.value.conj}
                        onChange={c =>
                            props.onChange(
                                setConj(props.value, c as 'and' | 'or'),
                            )
                        }
                        size="sm"
                    />
                    <Text as="span" size="ui" tone="muted">
                        of these
                    </Text>
                </div>
            </Show>
            <EditableRows
                isEmpty={props.value.rows.length === 0}
                empty={props.emptyHint}
                add={
                    <>
                        <IconTextButton icon="Plus" onClick={addCondition}>
                            add condition
                        </IconTextButton>
                        <IconTextButton
                            icon="Code"
                            onClick={() =>
                                props.onChange(addRow(props.value, rawRow()))
                            }
                        >
                            add expression
                        </IconTextButton>
                    </>
                }
            >
                <Index each={props.value.rows}>
                    {(row, i) => (
                        <FilterConditionRow
                            row={row()}
                            properties={properties()}
                            rows={props.rows}
                            config={props.config}
                            onPatch={p =>
                                props.onChange(patchRow(props.value, i, p))
                            }
                            onRemove={() =>
                                props.onChange(removeRow(props.value, i))
                            }
                            onToRaw={() =>
                                props.onChange(toRawRow(props.value, i))
                            }
                        />
                    )}
                </Index>
            </EditableRows>
        </div>
    )
}

export default FiltersEditor
