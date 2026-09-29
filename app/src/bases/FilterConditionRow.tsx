import { Match, Show, Switch, createMemo, type Component } from 'solid-js'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import Select, { type SelectOption } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { IconButton } from '../ui/IconButton'
import RemoveRowButton from '../ui/RemoveRowButton'
import { columnLabel } from './columnLabel'
import {
    DATE_PRESETS,
    defaultOpFor,
    editorKind as editorKindFor,
    folderValues,
    inferType,
    opsFor,
    tagValues,
} from './filterOps'
import { withCurrent } from './selectOptions'
import type { CondRow, FilterRow, RawRow } from './filterForm'
import type { NotesOp } from './queryGen'
import styles from './FilterConditionRow.module.css'

export type FilterConditionRowProps = {
    row: FilterRow
    /** Property ids offered in the property picker. */
    properties: string[]
    /** Sample rows — type inference plus the tag / folder value pickers. */
    rows: Row[]
    /** For display names (`properties:` displayName). */
    config?: BaseConfig
    onPatch: (patch: Partial<CondRow> | Partial<RawRow>) => void
    onRemove: () => void
    /** Swap a condition for an editable expression carrying its text. */
    onToRaw?: () => void
    class?: string
}

const opt = (v: string): SelectOption => ({ value: v, label: v })

/**
 * One filter condition: property / operator / value, or a raw Bases expression for anything
 * the three pickers can't express. The operator + value vocabulary is filterOps.ts's (shared
 * with the query builder); compiling the row to an expression is filterForm.ts's job.
 */
const FilterConditionRow: Component<FilterConditionRowProps> = props => {
    const cond = () => (props.row.kind === 'cond' ? props.row : null)

    const propOptions = createMemo<SelectOption[]>(() => {
        const ids = [...props.properties]
        const c = cond()
        if (c && !ids.includes(c.prop)) ids.push(c.prop)
        return ids.map(id => ({
            value: id,
            label: columnLabel(id, props.config ?? { view: { type: 'table' } }),
        }))
    })

    const setProp = (prop: string) => {
        const c = cond()
        if (!c) return
        const type = inferType(prop, props.rows)
        const keepOp = opsFor(type).some(o => o.value === c.op)
        props.onPatch({ prop, type, op: keepOp ? c.op : defaultOpFor(type) })
    }

    // Which value editor the operator calls for. A memo of a STRING, so it only changes when
    // the editor kind does — re-creating the editor on every keystroke would drop focus.
    const editorKind = createMemo(() => {
        const c = cond()
        return c ? editorKindFor(c.op, c.type) : 'none'
    })
    const val = () => cond()?.val ?? ''
    const setVal = (v: string) => props.onPatch({ val: v })
    const dateOptions = () =>
        !val() || DATE_PRESETS.some(p => p.value === val())
            ? DATE_PRESETS
            : [...DATE_PRESETS, opt(val())]

    const valueEditor = () => (
        <Switch>
            <Match when={editorKind() === 'tag'}>
                <Select
                    value={val()}
                    options={withCurrent(tagValues(props.rows).map(opt), val())}
                    placeholder="pick a tag"
                    onChange={setVal}
                />
            </Match>
            <Match when={editorKind() === 'folder'}>
                <Select
                    value={val()}
                    options={withCurrent(folderValues(props.rows).map(opt), val())}
                    placeholder="pick a folder"
                    onChange={setVal}
                />
            </Match>
            <Match when={editorKind() === 'date'}>
                <Select
                    value={val() || 'today'}
                    options={dateOptions()}
                    onChange={setVal}
                />
            </Match>
            <Match when={editorKind() === 'text'}>
                <TextInput
                    type={
                        cond()?.type === 'number' ||
                        cond()?.op === 'date_within'
                            ? 'number'
                            : 'text'
                    }
                    value={val()}
                    placeholder={
                        cond()?.op === 'date_within' ? 'days' : 'value'
                    }
                    onInput={setVal}
                />
            </Match>
        </Switch>
    )

    return (
        <Show
            when={cond()}
            fallback={
                <div class={`${styles.row} ${styles.raw} ${props.class ?? ''}`}>
                    <TextInput
                        class={styles.expr}
                        value={(props.row as RawRow).text}
                        placeholder="expression, e.g. price > 5 && !done"
                        onInput={text => props.onPatch({ text })}
                    />
                    <RemoveRowButton label="Remove condition" onClick={() => props.onRemove()} />
                </div>
            }
        >
            {c => (
                <div class={`${styles.row} ${props.class ?? ''}`}>
                    <Select
                        value={c().prop}
                        options={propOptions()}
                        onChange={setProp}
                    />
                    <Select
                        value={c().op}
                        options={opsFor(c().type, c().op)}
                        onChange={v => props.onPatch({ op: v as NotesOp })}
                    />
                    <div class={styles.val}>{valueEditor()}</div>
                    <div class={styles.actions}>
                        <Show when={props.onToRaw}>
                            <IconButton
                                icon="Code"
                                label="Edit as expression"
                                onClick={() => props.onToRaw?.()}
                            />
                        </Show>
                        <RemoveRowButton label="Remove condition" onClick={() => props.onRemove()} />
                    </div>
                </div>
            )}
        </Show>
    )
}

export default FilterConditionRow
