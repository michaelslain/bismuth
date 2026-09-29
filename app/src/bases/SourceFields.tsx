import { Show, createMemo, type Component } from 'solid-js'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import Select, { type SelectOption } from '../ui/Select'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import { withCurrent } from './selectOptions'
import FiltersEditor from './FiltersEditor'
import {
    SOURCE_CHOICES,
    patchSource,
    type SourceChoice,
    type SourceForm,
} from './sourceForm'

export type SourceFieldsProps = {
    value: SourceForm
    onChange: (form: SourceForm) => void
    /** `[[Name]]` options for the base pickers (from / ref). */
    bases: SelectOption[]
    properties: string[]
    rows: Row[]
    config?: BaseConfig
    class?: string
}

const stripLink = (v: string) => v.replace(/^\[\[|\]\]$/g, '')

/**
 * Where a base's rows come from: this base's own body rows, vault notes, vault tasks, or
 * another base — with the notes/tasks `where` filter built from condition rows and the
 * `from` / `ref` base pickers. Writes the canonical object form (sourceForm.ts).
 */
const SourceFields: Component<SourceFieldsProps> = props => {
    const set = (patch: Parameters<typeof patchSource>[1]) =>
        props.onChange(patchSource(props.value, patch))

    const fromOptions = createMemo<SelectOption[]>(() =>
        withCurrent(
            [{ value: '', label: 'the whole vault' }, ...props.bases],
            props.value.from,
            stripLink,
        ),
    )
    const refOptions = createMemo(() =>
        withCurrent(props.bases, props.value.ref, stripLink),
    )
    const scoped = () =>
        props.value.kind === 'notes' || props.value.kind === 'tasks'

    return (
        <SettingsGrid class={props.class}>
            <SettingsField
                label="rows from"
                hint={
                    props.value.kind === 'own'
                        ? "rows come from the table in this base's body — with no table, every note in the vault."
                        : undefined
                }
            >
                <Select
                    value={props.value.kind}
                    options={SOURCE_CHOICES}
                    onChange={v => set({ kind: v as SourceChoice })}
                />
            </SettingsField>
            <Show when={scoped()}>
                <SettingsField
                    label="limit to base"
                    hint="only the notes another base selects."
                >
                    <Select
                        value={props.value.from}
                        options={fromOptions()}
                        placeholder="the whole vault"
                        onChange={v => set({ from: v })}
                    />
                </SettingsField>
            </Show>
            <Show when={props.value.kind === 'base'}>
                <SettingsField label="base">
                    <Select
                        value={props.value.ref}
                        options={refOptions()}
                        placeholder="pick a base"
                        onChange={v => set({ ref: v })}
                    />
                </SettingsField>
            </Show>
            <Show when={scoped()}>
                <SettingsField label="where" span>
                    <FiltersEditor
                        value={props.value.where}
                        onChange={where =>
                            props.onChange({ ...props.value, where })
                        }
                        properties={props.properties}
                        rows={props.rows}
                        config={props.config}
                        emptyHint={
                            props.value.kind === 'tasks'
                                ? 'no conditions — every task is included.'
                                : 'no conditions — every note is included.'
                        }
                    />
                </SettingsField>
            </Show>
        </SettingsGrid>
    )
}

export default SourceFields
