// app/src/ui/ColorChip.tsx
// A colour swatch chip with an attached palette popover — extracted from CategoryPanel, which
// used to hand-roll a private `ColorChip` + `Palette` pair for its own rows. Any caller that
// shows a stored colour (a palette token or any CSS colour) and lets it be repicked from the
// theme swatches uses this instead, so the popover open/close and colour-resolution logic lives
// in exactly one place. `CategoryPanel.tsx` and `TaskCalendarSettings.tsx` both compose it.
import { type Component, For, Show } from 'solid-js'
import Swatch from './Swatch'
import { THEME_SWATCHES, resolveCategoryColor } from '../calendar/categoryColor'
import styles from './ColorChip.module.css'

/** Palette popover: the seven palette tokens (PALETTE_TOKENS) — token-driven, no custom hex
 *  wheel. A colour already set to a non-token value (a hex from before this) just shows no
 *  swatch highlighted; picking any swatch here replaces it. */
const Palette: Component<{
    value: string
    onPick: (token: string) => void
    up?: boolean
}> = props => (
    <div
        class={`${styles['pop']}${props.up ? ` ${styles['up']}` : ''}`}
        data-testid="category-palette"
        onClick={e => e.stopPropagation()}
    >
        <div class={styles['sws']}>
            <For each={THEME_SWATCHES}>
                {tok => (
                    <Swatch
                        color={`var(--${tok})`}
                        label={tok}
                        selected={
                            props.value === tok ||
                            props.value === `var(--${tok})`
                        }
                        onClick={() => props.onPick(tok)}
                    />
                )}
            </For>
        </div>
    </div>
)

export type ColorChipProps = {
    /** The stored colour — a palette token name or any CSS colour. */
    color: string
    /** Whether this chip's palette popover is open. The caller owns which one is. */
    open: boolean
    /** Open the popover upwards, for a chip near the bottom of its container. */
    up?: boolean
    onToggle: () => void
    onPick: (token: string) => void
    class?: string
}

const ColorChip: Component<ColorChipProps> = props => (
    // Stopping `mousedown` here (not `click`) is what actually matters: a caller's outside-click
    // guard (CategoryPanel's, e.g.) listens for `mousedown` on window, so this is the event that
    // must never leave this subtree. Stopping it declares "this press is mine" to the guard
    // without the guard ever needing to interrogate the DOM for a class name — so nothing here
    // breaks when this file's classes become CSS-module hashed locals.
    <div
        class={`${styles['chipwrap']} ${props.class ?? ''}`}
        data-testid="category-chip"
        onMouseDown={e => e.stopPropagation()}
    >
        <Swatch
            size="sm"
            color={resolveCategoryColor(props.color)}
            label="Choose colour"
            selected={props.open}
            onClick={props.onToggle}
        />
        <Show when={props.open}>
            <Palette value={props.color} onPick={props.onPick} up={props.up} />
        </Show>
    </div>
)

export default ColorChip
