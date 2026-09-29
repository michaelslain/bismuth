import { Index, Show, type Component } from 'solid-js'
import type { SortSpec } from '../../../core/src/bases/types'
import Select, { type SelectOption } from '../ui/Select'
import { withCurrent } from './selectOptions'
import SettingsField from '../ui/SettingsField'
import RemoveRowButton from '../ui/RemoveRowButton'
import { IconTextButton } from '../ui/IconTextButton'
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
 * its own direction. The previous panel edited only the first key and silently dropped the rest.
 */
const SortFields: Component<SortFieldsProps> = props => {
    const update = (i: number, patch: Partial<SortSpec>) =>
        props.onChange(
            props.sort.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
        )
    const remove = (i: number) =>
        props.onChange(props.sort.filter((_, idx) => idx !== i))
    const add = () => {
        const used = new Set(props.sort.map(s => s.property))
        const next = props.options.find(o => !used.has(o.value))?.value
        if (next)
            props.onChange([
                ...props.sort,
                { property: next, direction: 'ASC' },
            ])
    }

    return (
        <div class={`${styles.list} ${props.class ?? ''}`}>
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
                <Index each={props.sort}>
                    {(s, i) => (
                        <SettingsField label={i === 0 ? 'sort by' : 'then by'}>
                            <div class={styles.row}>
                                <Select
                                    value={s().property}
                                    options={withCurrent(
                                        props.options,
                                        s().property,
                                    )}
                                    onChange={property =>
                                        update(i, { property })
                                    }
                                />
                                <Select
                                    value={s().direction ?? 'ASC'}
                                    options={DIR_OPTS}
                                    onChange={d =>
                                        update(i, {
                                            direction: d as 'ASC' | 'DESC',
                                        })
                                    }
                                />
                                <RemoveRowButton label="Remove sort key" onClick={() => remove(i)} />
                            </div>
                        </SettingsField>
                    )}
                </Index>
                <div>
                    <IconTextButton icon="Plus" onClick={add}>
                        then by
                    </IconTextButton>
                </div>
            </Show>
        </div>
    )
}

export default SortFields
