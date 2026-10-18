import type { Component } from 'solid-js'
import { For } from 'solid-js'
import StepSlider from '../ui/StepSlider'
import Text from '../ui/Text'
import ToggleRow from '../ui/ToggleRow'
import {
    PRIVACY_LEVELS,
    PRIVACY_OPTIONS,
    applyLevel,
    levelOf,
    togglePrivacy,
    type PrivacyLevelId,
    type PrivacyValues,
} from './introPrivacy'
import styles from './PrivacyPicker.module.css'

export type PrivacyPickerProps = {
    values: PrivacyValues
    onChange: (values: PrivacyValues) => void
    class?: string
}

/** The privacy slide's body: the level slider centred over every privacy switch, two columns wide
 *  (one under 560px). A switch whose prerequisite is off is locked and muted. */
const PrivacyPicker: Component<PrivacyPickerProps> = props => {
    const level = () => {
        const l = levelOf(props.values)
        return l === 'custom' ? null : l
    }
    return (
        <div class={[styles.picker, props.class ?? ''].filter(Boolean).join(' ')}>
            <StepSlider
                label="privacy level"
                stops={PRIVACY_LEVELS.map(l => ({ id: l.id, label: l.label }))}
                value={level()}
                onChange={id => props.onChange(applyLevel(id as PrivacyLevelId))}
            />
            <div class={styles.rows}>
                <For each={PRIVACY_OPTIONS}>
                    {o => {
                        const blocked = () => !!o.needs && !props.values[o.needs]
                        return (
                            <ToggleRow
                                icon={o.icon}
                                label={o.name}
                                description={
                                    <Text size="body" tone="muted" register="prose">
                                        {o.desc}
                                    </Text>
                                }
                                checked={props.values[o.id]}
                                locked={blocked()}
                                muted={blocked()}
                                title={blocked() ? 'Needs memory recall' : undefined}
                                onToggle={() => props.onChange(togglePrivacy(props.values, o.id))}
                            />
                        )
                    }}
                </For>
            </div>
        </div>
    )
}

export default PrivacyPicker
