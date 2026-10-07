import { Index, Show, createMemo, type Component } from 'solid-js'
import { TextInput } from '../ui/TextInput'
import { IconTextButton } from '../ui/IconTextButton'
import SettingsHint from '../ui/SettingsHint'
import EditableRows from './EditableRows'
import EditableRow from './EditableRow'
import {
    duplicateFormulaNames,
    formulaError,
    addFormula,
    removeFormula,
    updateFormula,
    type FormulaRow,
} from './formulasForm'
import styles from './FormulasEditor.module.css'

export type FormulasEditorProps = {
    rows: FormulaRow[]
    onChange: (rows: FormulaRow[]) => void
    class?: string
}

/**
 * The base's `formulas:` map as name / expression rows: add, rename, edit, remove. A formula
 * becomes the column `formula.<name>` — usable in the columns list, sort, group, filters and
 * other formulas. Duplicate names are flagged (the settings panel blocks SAVE on them) and an
 * expression the parser rejects says why under the field.
 */
const FormulasEditor: Component<FormulasEditorProps> = props => {
    const dupes = createMemo(() => duplicateFormulaNames(props.rows))
    const update = (i: number, patch: Partial<FormulaRow>) =>
        props.onChange(updateFormula(props.rows, i, patch))

    return (
        <EditableRows
            class={props.class}
            isEmpty={props.rows.length === 0}
            add={
                <IconTextButton
                    icon="Plus"
                    onClick={() => props.onChange(addFormula(props.rows))}
                >
                    add formula
                </IconTextButton>
            }
        >
            <Index each={props.rows}>
                {(row, i) => {
                    const err = () => formulaError(row().expr)
                    return (
                        <EditableRow
                            noun="formula"
                            onRemove={() =>
                                props.onChange(removeFormula(props.rows, i))
                            }
                            hint={
                                <>
                                    <Show when={dupes().has(i)}>
                                        <SettingsHint class={styles.warn}>
                                            duplicate name // rename it to save
                                        </SettingsHint>
                                    </Show>
                                    <Show when={err()}>
                                        <SettingsHint class={styles.warn}>
                                            can't parse // {err()}
                                        </SettingsHint>
                                    </Show>
                                </>
                            }
                        >
                            <div class={styles.row}>
                                <TextInput
                                    value={row().name}
                                    placeholder="name"
                                    aria-label="Formula name"
                                    onInput={name => update(i, { name })}
                                />
                                <TextInput
                                    class={styles.expr}
                                    value={row().expr}
                                    placeholder="expression, e.g. price * qty"
                                    aria-label="Formula expression"
                                    onInput={expr => update(i, { expr })}
                                />
                            </div>
                        </EditableRow>
                    )
                }}
            </Index>
        </EditableRows>
    )
}

export default FormulasEditor
