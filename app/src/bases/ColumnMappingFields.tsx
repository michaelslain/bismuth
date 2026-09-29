import { For, Show, type Component } from 'solid-js'
import Select from '../ui/Select'
import Text from '../ui/Text'
import InlineCode from '../ui/InlineCode'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import SettingsHint from '../ui/SettingsHint'
import ToggleRow from '../ui/ToggleRow'
import { columnBindingOptions, type FieldDef } from './baseSettingsPlan'
import styles from './ColumnMappingFields.module.css'

export type ColumnMappingFieldsProps = {
    /** The bindings this view kind offers (`fieldsFor(kind)`). */
    fields: FieldDef[]
    /** Current column per binding key. */
    value: Record<string, string>
    /** Every column the pickers can offer. */
    columns: string[]
    onChange: (key: string, column: string) => void
    /** Flashcards only: review each card both ways. Shown when `onBidirectional` is given. */
    bidirectional?: boolean
    onBidirectional?: (on: boolean) => void
    class?: string
}

/** Which column means what — flashcards' front/back/due, a map's lat/lng, a card cover, a chart's
 *  axes — one labelled column picker per binding, plus flashcards' bidirectional toggle. */
const ColumnMappingFields: Component<ColumnMappingFieldsProps> = props => (
    <div class={props.class}>
        <SettingsGrid>
            <For each={props.fields}>
                {f => (
                    <SettingsField
                        label={`${f.role.toLowerCase()} column`}
                        badge={f.optional ? 'optional' : 'required'}
                        hint={f.hint}
                    >
                        <Select
                            value={props.value[f.key] ?? ''}
                            options={columnBindingOptions(
                                f,
                                props.value[f.key] ?? '',
                                props.columns,
                            )}
                            placeholder={f.noneLabel ?? 'Not set'}
                            onChange={c => props.onChange(f.key, c)}
                        />
                    </SettingsField>
                )}
            </For>
        </SettingsGrid>
        <Show when={props.onBidirectional}>
            <ToggleRow
                class={styles.spaced}
                wrap
                label="bidirectional — review each card both ways (front ↔ back)"
                checked={!!props.bidirectional}
                onToggle={() => props.onBidirectional?.(!props.bidirectional)}
            />
            <SettingsHint>
                scheduling uses the standard SM-2 algorithm (fixed, not
                configurable). use{' '}
                <Text as="span" inherit weight="bold">
                    cram
                </Text>{' '}
                in the deck to review everything without affecting scheduling.
                <Show when={props.bidirectional}>
                    {' '}
                    each direction is scheduled independently (reverse state
                    lives in <InlineCode>dueBack</InlineCode> /{' '}
                    <InlineCode>easeBack</InlineCode> /{' '}
                    <InlineCode>intervalBack</InlineCode>).
                </Show>
            </SettingsHint>
        </Show>
    </div>
)

export default ColumnMappingFields
