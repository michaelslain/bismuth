import { createMemo, Index, Show, type Component } from 'solid-js'
import type { SortSpec } from '../../../core/src/bases/types'
import Select, { type SelectOption } from '../ui/Select'
import { IconButton } from '../ui/IconButton'
import { IconTextButton } from '../ui/IconTextButton'
import SettingsField from '../ui/SettingsField'
import { withCurrent } from './selectOptions'
import { moveRow } from './basePropertiesForm'
import EditableRows from './EditableRows'
import EditableRow from './EditableRow'
import styles from './SortFields.module.css'

export type SortFieldsProps = {
    /** The view's sort keys, in priority order. */
    sort: SortSpec[]
    onChange: (sort: SortSpec[]) => void
    /** Property options (without a "none" entry). */
    options: SelectOption[]
    class?: string
}

const DIR_OPTS: SelectOption[] = [
    { value: 'ASC', label: 'ascending' },
    { value: 'DESC', label: 'descending' },
]

/**
 * A view's `sort:` as an ordered list — "sort by" then any number of "then by" keys, each with
 * its own direction and an up / down pair, because the ORDER of the keys is what a sort means.
 * The previous panel edited only the first key and silently dropped the rest.
 */
const SortFields: Component<SortFieldsProps> = props => {
    const update = (i: number, patch: Partial<SortSpec>) =>
        props.onChange(
            props.sort.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
        )
    const remove = (i: number) =>
        props.onChange(props.sort.filter((_, idx) => idx !== i))
    const move = (i: number, dir: -1 | 1) =>
        props.onChange(moveRow(props.sort, i, dir))
    // The first option no key uses yet — what "add sort key" appends. None left = nothing to add.
    const nextOption = createMemo(() => {
        const used = new Set(props.sort.map(s => s.property))
        return props.options.find(o => !used.has(o.value))?.value
    })
    const add = () => {
        const next = nextOption()
        if (next)
            props.onChange([
                ...props.sort,
                { property: next, direction: 'ASC' },
            ])
    }

    return (
        <div class={props.class}>
            <Show
                when={props.sort.length > 0}
                fallback={
                    <SettingsField label="sort by">
                        <Select
                            value=""
                            options={props.options}
                            placeholder="none"
                            onChange={property =>
                                props.onChange([{ property, direction: 'ASC' }])
                            }
                        />
                    </SettingsField>
                }
            >
                <EditableRows
                    add={
                        <IconTextButton
                            icon="Plus"
                            disabled={!nextOption()}
                            title={
                                nextOption()
                                    ? undefined
                                    : 'every property is already a sort key'
                            }
                            onClick={add}
                        >
                            add sort key
                        </IconTextButton>
                    }
                >
                    <Index each={props.sort}>
                        {(s, i) => (
                            <EditableRow
                                noun="sort key"
                                label={i === 0 ? 'sort by' : 'then by'}
                                onRemove={() => remove(i)}
                                actions={
                                    <>
                                        <IconButton
                                            icon="ArrowUp"
                                            label={`Move sort key ${i + 1} up`}
                                            disabled={i === 0}
                                            onClick={() => move(i, -1)}
                                        />
                                        <IconButton
                                            icon="ArrowDown"
                                            label={`Move sort key ${i + 1} down`}
                                            disabled={
                                                i === props.sort.length - 1
                                            }
                                            onClick={() => move(i, 1)}
                                        />
                                    </>
                                }
                            >
                                <div class={styles.keyFields}>
                                    <Select
                                        value={s().property}
                                        options={withCurrent(
                                            props.options,
                                            s().property,
                                        )}
                                        label={i === 0 ? 'sort by' : 'then by'}
                                        onChange={property =>
                                            update(i, { property })
                                        }
                                    />
                                    <Select
                                        value={s().direction ?? 'ASC'}
                                        options={DIR_OPTS}
                                        label={`sort key ${i + 1} direction`}
                                        onChange={d =>
                                            update(i, {
                                                direction: d as 'ASC' | 'DESC',
                                            })
                                        }
                                    />
                                </div>
                            </EditableRow>
                        )}
                    </Index>
                </EditableRows>
            </Show>
        </div>
    )
}

export default SortFields
