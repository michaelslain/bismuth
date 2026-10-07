// app/src/ui/ColorChip.tsx
// A colour swatch chip with an attached palette popover. Any caller that shows a stored colour
// and lets it be repicked from a palette uses this: the calendar's categories (the 7 theme
// tokens, stored by name) and Kanban's column colours (5 raw `var(--graph-N)` values plus an
// `auto` entry). `onPick` hands back the palette entry verbatim, so each caller stores whatever
// shape its palette holds. The popover is an `AnchoredPopover`, which places it, flips it at a
// viewport edge and dismisses it on Escape or an outside press.
import { type Component, For, type JSX, Show } from 'solid-js'
import AnchoredPopover from './AnchoredPopover'
import ChipToggle from './ChipToggle'
import PlainButton from './PlainButton'
import Popover from './Popover'
import Swatch from './Swatch'
import { PALETTE_TOKENS, resolvePaletteColor } from './palette'
import styles from './ColorChip.module.css'

export type ColorChipProps = {
    /** The current value: a palette token name or any CSS colour. Empty paints an empty dashed box (no colour chosen), not a hue.
     *  A caller with an `auto` entry should pass its EFFECTIVE colour (the computed one), not
     *  the stored null, or the chip shows the accent instead of the colour actually in use. */
    color: string
    /** Whether this chip's palette popover is open. The caller owns which one is. */
    open: boolean
    onToggle: () => void
    /** The palette entry picked, verbatim. */
    onPick: (value: string) => void
    /** Entries to offer; default is PALETTE_TOKENS. Entries may be raw CSS (`var(--graph-2)`). */
    palette?: readonly string[]
    /** Renders a first entry for "no explicit colour". */
    auto?: { label: string; selected: boolean; onPick: () => void }
    class?: string
    /** A custom visible trigger (a StatusDot, say) rendered in place of the Swatch, inside the
     *  chip's own toggle button — same toggle, same accessible name and pressed state. */
    trigger?: JSX.Element
    /** The element the popover anchors to; default is the chip itself. */
    anchor?: () => HTMLElement | undefined
    /** Where the popover opens relative to its anchor; default `below`. */
    placement?: 'below' | 'above'
}

/** Accessible name for an entry: a token is its own name, `var(--graph-3)` reads `graph-3`. */
function entryLabel(entry: string): string {
    return entry.replace(/^var\(--(.+)\)$/, '$1')
}

const ColorChip: Component<ColorChipProps> = props => {
    let wrapEl: HTMLDivElement | undefined
    const isSelected = (entry: string) =>
        !props.auto?.selected &&
        resolvePaletteColor(props.color) === resolvePaletteColor(entry)

    return (
        <div
            ref={wrapEl}
            class={`${styles['chipwrap']} ${props.class ?? ''}`}
            data-testid="category-chip"
        >
            <Show
                when={props.trigger}
                fallback={
                    <Swatch
                        size="sm"
                        color={resolvePaletteColor(props.color)}
                        label="Choose colour"
                        selected={props.open}
                        onClick={props.onToggle}
                    />
                }
            >
                <PlainButton
                    class={styles['trigger']}
                    aria-label="Choose colour"
                    title="Choose colour"
                    aria-pressed={props.open ? 'true' : undefined}
                    onClick={() => props.onToggle()}
                >
                    {props.trigger}
                </PlainButton>
            </Show>
            <AnchoredPopover
                anchor={() => props.anchor?.() ?? wrapEl}
                toggleEl={() => wrapEl}
                placement={props.placement}
                open={props.open}
                onDismiss={props.onToggle}
                panelAttrs={{ 'data-testid': 'category-palette' }}
            >
                <Popover tone="panel">
                    <div class={styles['sws']}>
                        <Show when={props.auto}>
                            {auto => (
                                <ChipToggle
                                    selected={auto().selected}
                                    onToggle={auto().onPick}
                                >
                                    {auto().label}
                                </ChipToggle>
                            )}
                        </Show>
                        <For each={props.palette ?? PALETTE_TOKENS}>
                            {entry => (
                                <Swatch
                                    color={resolvePaletteColor(entry)}
                                    label={entryLabel(entry)}
                                    selected={isSelected(entry)}
                                    onClick={() => props.onPick(entry)}
                                />
                            )}
                        </For>
                    </div>
                </Popover>
            </AnchoredPopover>
        </div>
    )
}

export default ColorChip
