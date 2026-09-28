// The event form's repeat controls: a none/daily/weekly/biweekly/monthly segmented toggle, the
// weekday chips for weekly + biweekly, and the optional `ends` date while any repeat is chosen.
// Returns two SettingsField rows, so it sits directly inside the form's SettingsGrid.
import { For, Show, type Component } from 'solid-js'
import type { RecurrenceType } from '../types'
import { RECUR, DOW } from '../eventForm'
import SettingsField from '../../ui/SettingsField'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import ChipToggle from '../../ui/ChipToggle'
import DateFieldEditor from '../../bases/DateFieldEditor'
import styles from './RecurrenceField.module.css'

export type RecurrenceFieldProps = {
    type: RecurrenceType | ''
    days: number[]
    /** ISO date the series ends on, or '' for never. */
    end: string
    onType: (t: RecurrenceType | '') => void
    onDays: (days: number[]) => void
    onEnd: (end: string) => void
}

const RecurrenceField: Component<RecurrenceFieldProps> = props => {
    const weekly = () => props.type === 'weekly' || props.type === 'biweekly'
    return (
        <>
            <SettingsField label="repeat">
                <SegmentedToggle
                    value={props.type}
                    onChange={props.onType}
                    options={RECUR.map(([label, val]) => ({ id: val, label }))}
                />
                <Show when={weekly()}>
                    <div class={styles.dows} data-testid="recurrence-days">
                        <For each={DOW}>
                            {([label, i]) => (
                                <ChipToggle
                                    selected={props.days.includes(i)}
                                    onToggle={() =>
                                        props.onDays(
                                            props.days.includes(i)
                                                ? props.days.filter(x => x !== i)
                                                : [...props.days, i],
                                        )
                                    }
                                >
                                    {label}
                                </ChipToggle>
                            )}
                        </For>
                    </div>
                </Show>
            </SettingsField>
            <Show when={props.type}>
                <SettingsField label="ends" badge="optional">
                    <DateFieldEditor
                        value={props.end}
                        placeholder="never"
                        onCommit={v => props.onEnd(v ? String(v) : '')}
                    />
                </SettingsField>
            </Show>
        </>
    )
}

export default RecurrenceField
export { RecurrenceField }
