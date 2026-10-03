// One theme as a selectable card: a literal bg/fg/accent preview over the theme's name.
//
// The colours are the core token LITERALS (THEMES[name]), not var(--bg) etc., on purpose: all four
// cards render at once and the running app has no per-subtree theme scope (that only exists in the
// static design-system demo CSS), so a live multi-theme comparison can only be literal colours.
// The same technique the drawing toolbar's ink swatches use.
import type { Component } from 'solid-js'
import PlainButton from '../ui/PlainButton'
import Swatch from '../ui/Swatch'
import Text from '../ui/Text'
import { THEMES, THEME_LABELS, type ThemeName } from '../themes'
import styles from './ThemeSwatchCard.module.css'

export type ThemeSwatchCardProps = {
    name: ThemeName
    selected: boolean
    onSelect: () => void
    class?: string
}

const ThemeSwatchCard: Component<ThemeSwatchCardProps> = props => (
    <PlainButton
        class={`${styles['card']} ${props.class ?? ''}`}
        classList={{ [styles['selected']!]: props.selected }}
        aria-pressed={props.selected}
        onClick={() => props.onSelect()}
    >
        <Text as="div" inherit class={styles['well']}>
            <Swatch static color={THEMES[props.name].background} class={styles['preview']} />
            <Swatch
                static
                color={THEMES[props.name].foreground}
                class={`${styles['chip']} ${styles['chip-fg']}`}
            />
            <Swatch
                static
                color={THEMES[props.name].accent}
                class={`${styles['chip']} ${styles['chip-accent']}`}
            />
        </Text>
        <Text as="span" size="micro" eyebrow tone="muted" class={styles['name']}>
            {THEME_LABELS[props.name]}
        </Text>
    </PlainButton>
)

export default ThemeSwatchCard
