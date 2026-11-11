import type { Component } from 'solid-js'
import { For, Show } from 'solid-js'
import StepSlider from '../ui/StepSlider'
import Text from '../ui/Text'
import ToggleRow from '../ui/ToggleRow'
import {
    PRIVACY_LEVELS,
    applyLevel,
    levelOf,
    privacyOptions,
    togglePrivacy,
    type PrivacyLevelId,
    type PrivacyValues,
} from './introPrivacy'
import styles from './PrivacyPicker.module.css'

export type PrivacyPickerProps = {
    values: PrivacyValues
    onChange: (values: PrivacyValues) => void
    /** The daemon power-up is on: the level slider and the daemon's switches show. Default true. */
    daemon?: boolean
    class?: string
}

/** The privacy slide's body: the level slider centred over every privacy switch, two columns wide
 *  (one under 560px). A switch whose prerequisite is off is locked and muted. Without the daemon
 *  only the switches that need no daemon show (ask from find), and no slider. */
const PrivacyPicker: Component<PrivacyPickerProps> = props => {
    const daemon = () => props.daemon ?? true
    const level = () => {
        const l = levelOf(props.values)
        return l === 'custom' ? null : l
    }
    return (
        <div class={[styles.picker, props.class ?? ''].filter(Boolean).join(' ')}>
            <Show when={daemon()}>
                <StepSlider
                    label="privacy level"
                    stops={PRIVACY_LEVELS.map(l => ({ id: l.id, label: l.label }))}
                    value={level()}
                    onChange={id => props.onChange(applyLevel(id as PrivacyLevelId))}
                />
            </Show>
            <div class={[styles.rows, daemon() ? '' : styles.single].filter(Boolean).join(' ')}>
                <For each={privacyOptions(daemon())}>
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
