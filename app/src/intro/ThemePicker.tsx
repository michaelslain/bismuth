// The four theme cards in one labelled group — the intro's theme slide.
import { For, type Component } from 'solid-js'
import ThemeSwatchCard from './ThemeSwatchCard'
import { THEME_NAMES, type ThemeName } from '../themes'
import styles from './ThemePicker.module.css'

export type ThemePickerProps = {
    value: ThemeName
    onChange: (name: ThemeName) => void
    class?: string
}

const ThemePicker: Component<ThemePickerProps> = props => (
    <div role="group" aria-label="Theme" class={`${styles['picker']} ${props.class ?? ''}`}>
        <For each={THEME_NAMES}>
            {name => (
                <ThemeSwatchCard
                    {...{ name }}
                    selected={props.value === name}
                    onSelect={() => props.onChange(name)}
                />
            )}
        </For>
    </div>
)

export default ThemePicker
