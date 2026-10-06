// One theme as a selectable card: the theme's ground with every colour it paints in (text, muted,
// accent, and the graph ramp) laid on it, over the theme's name.
//
// The colours are the core token LITERALS (THEMES[name]), not var(--bg) etc., on purpose: all four
// cards render at once and the running app has no per-subtree theme scope (that only exists in the
// static design-system demo CSS), so a live multi-theme comparison can only be literal colours.
// The same technique the drawing toolbar's ink swatches use.
import { For, type Component } from 'solid-js'
import PlainButton from '../ui/PlainButton'
import Swatch from '../ui/Swatch'
import Text from '../ui/Text'
import { THEMES, type ThemeName } from '../themes'
import styles from './ThemeSwatchCard.module.css'

export type ThemeSwatchCardProps = {
    name: ThemeName
    selected: boolean
    onSelect: () => void
    class?: string
}

/** Text, muted and accent — the three colours a UI surface paints with. */
const baseColours = (name: ThemeName) => [
    THEMES[name].foreground,
    THEMES[name].neutral,
    THEMES[name].accent,
]

const ThemeSwatchCard: Component<ThemeSwatchCardProps> = props => (
    <PlainButton
        class={`${styles['card']} ${props.class ?? ''}`}
        classList={{ [styles['selected']!]: props.selected }}
        aria-pressed={props.selected}
        onClick={() => props.onSelect()}
    >
        <Text as="div" inherit class={styles['well']}>
            <Swatch
                static
                color={THEMES[props.name].background}
                class={styles['preview']}
            />
            {/* Every colour the theme paints with: text, muted, accent, then the graph ramp. */}
            <Text as="div" inherit class={styles['chips']}>
                <For each={baseColours(props.name)}>
                    {color => (
                        <Swatch static {...{ color }} class={styles['chip']} />
                    )}
                </For>
                <Text as="div" inherit class={styles['ramp']}>
                    <For each={THEMES[props.name].accentPalette}>
                        {color => (
                            <Swatch
                                static
                                {...{ color }}
                                class={styles['chip']}
                            />
                        )}
                    </For>
                </Text>
            </Text>
        </Text>
        <Text as="span" size="ui" tone={props.selected ? undefined : 'muted'}>
            {props.name}
        </Text>
    </PlainButton>
)

export default ThemeSwatchCard
