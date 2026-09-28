import { type Component } from 'solid-js'
import Select, { type SelectOption } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'

export type BaseSourcePanelProps = {
    /** The picked base as a `[[Name]]` ref. */
    baseRef: string | undefined
    /** An optional Bases expression layered on the base's rows. */
    baseWhere: string | undefined
    onChange: (patch: { baseRef?: string; baseWhere?: string }) => void
    /** `[[Name]]` options for the picker. */
    bases: SelectOption[]
    class?: string
}

/** The Base source: render another base's rows, optionally narrowed by one expression. */
const BaseSourcePanel: Component<BaseSourcePanelProps> = props => (
    <SettingsGrid class={props.class}>
        <SettingsField
            label="base to query"
            span
            hint="renders another base's rows; the view/sort/group below override its own."
        >
            <Select
                value={props.baseRef ?? ''}
                options={props.bases}
                placeholder="Pick a base"
                onChange={baseRef => props.onChange({ baseRef })}
            />
        </SettingsField>
        <SettingsField
            label="filter"
            badge="optional"
            span
            hint="an optional Bases expression to further filter the base's rows."
        >
            <TextInput
                value={props.baseWhere ?? ''}
                placeholder="e.g. rating >= 4"
                onInput={v => props.onChange({ baseWhere: v || undefined })}
            />
        </SettingsField>
    </SettingsGrid>
)

export default BaseSourcePanel
