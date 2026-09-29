import { Show, type Component } from 'solid-js'
import type { ViewType } from '../../../core/src/bases/types'
import Select from '../ui/Select'
import { VIEW_KIND_OPTIONS } from './selectOptions'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'

export type ViewIdentityFieldsProps = {
    kind: ViewType
    mode: 'normal' | 'tasks'
    /** Whether the kind offers a tasks mode (record views + calendar). */
    showMode: boolean
    onKind: (kind: ViewType) => void
    onMode: (mode: 'normal' | 'tasks') => void
    class?: string
}

/** What the view IS: its kind (one of the 12 renderers), and whether every row
 *  is a task (`mode: tasks` — status box, status menu, field chips). */
const ViewIdentityFields: Component<ViewIdentityFieldsProps> = props => (
    <SettingsGrid class={props.class}>
        <SettingsField
            label="kind"
            hint="settings below follow the kind you pick."
        >
            <Select
                value={props.kind}
                options={VIEW_KIND_OPTIONS}
                onChange={v => props.onKind(v as ViewType)}
            />
        </SettingsField>
        <Show when={props.showMode}>
            <SettingsField
                label="rows are"
                hint={
                    props.mode === 'tasks'
                        ? 'every row is a task: a status box, the status menu and due/priority chips.'
                        : 'rows are plain records.'
                }
            >
                <SegmentedToggle
                    options={[
                        { id: 'normal', label: 'records' },
                        { id: 'tasks', label: 'tasks' },
                    ]}
                    value={props.mode}
                    onChange={m => props.onMode(m as 'normal' | 'tasks')}
                    size="sm"
                />
            </SettingsField>
        </Show>
    </SettingsGrid>
)

export default ViewIdentityFields
