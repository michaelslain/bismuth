// The "column mapping" section of a calendar's settings modal: one Select per calendar field,
// choosing which frontmatter column carries it. Presentational — CalendarSettings owns the draft
// map and the save. Returns a bare Fragment so its section + grid stay literal children of the
// modal body (ModalBody's `.body > *` rule).
import { For, type Component } from 'solid-js'
import { FIELDS, columnOptions } from '../calendarColumnMap'
import Select from '../../ui/Select'
import SettingsSection from '../../ui/SettingsSection'
import SettingsGrid from '../../ui/SettingsGrid'
import SettingsField from '../../ui/SettingsField'

export type CalendarColumnMappingProps = {
    /** The draft: field key -> chosen column ('' = not set). */
    values: Record<string, string>
    /** Every column a field can be bound to. */
    columns: string[]
    onChange: (key: string, column: string) => void
}

const CalendarColumnMapping: Component<CalendarColumnMappingProps> = props => (
    <>
        <SettingsSection>column mapping</SettingsSection>
        <SettingsGrid>
            <For each={FIELDS}>
                {f => (
                    <SettingsField
                        label={f.role}
                        badge={f.req ? 'required' : 'optional'}
                        hint={f.hint}
                    >
                        <Select
                            value={props.values[f.key] ?? ''}
                            options={columnOptions(props.columns, !f.req)}
                            placeholder="not set"
                            onChange={c => props.onChange(f.key, c)}
                        />
                    </SettingsField>
                )}
            </For>
        </SettingsGrid>
    </>
)

export default CalendarColumnMapping
