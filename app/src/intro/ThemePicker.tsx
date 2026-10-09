// The intro's theme choice: the theme names as one segmented row. No swatches: picking a name
// re-themes the whole intro live, so the window itself is the preview.
import type { Component } from 'solid-js'
import SegmentedToggle from '../ui/SegmentedToggle'
import { THEME_NAMES, type ThemeName } from '../themes'
import styles from './ThemePicker.module.css'

export type ThemePickerProps = {
    value: ThemeName
    onChange: (name: ThemeName) => void
    class?: string
}

const ThemePicker: Component<ThemePickerProps> = props => (
    <div
        role="group"
        aria-label="Theme"
        class={[styles.picker, props.class ?? ''].filter(Boolean).join(' ')}
    >
        <SegmentedToggle
            options={THEME_NAMES.map(name => ({ id: name, label: name }))}
            value={props.value}
            onChange={props.onChange}
        />
    </div>
)

export default ThemePicker
