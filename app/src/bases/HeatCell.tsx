import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import PlainButton from '../ui/PlainButton'
import Text from '../ui/Text'
import styles from './HeatCell.module.css'

export type HeatCellProps = {
    /** ISO day this square stands for — written to `data-bucket`, the runtime hook stories and
     *  the drill read. Omitted on a legend swatch. */
    date?: string
    /** 0 = no data, 1..3 = the three intensity tiers (`levelOf` in heatmapLayout.ts). */
    level: number
    /** The glyph typed into the square (`glyphOf(level)`). */
    glyph: string
    /** The clicked/drilled square: drawn in `--fg` whatever its tier. */
    selected?: boolean
    /** The pointer is over this square, or keyboard focus is on it — drawn in `--fg` on a hover wash
     *  so the grid itself shows where the readout is pointing (Bar recolours its row, Line drops an
     *  `@`; a heatmap square used to show nothing at all). */
    hovered?: boolean
    /** Accessible name, e.g. `Tue Jul 8: 42` — a glyph alone names nothing. */
    label?: string
    /** Pointer enters (`true`) or leaves (`false`), or focus arrives/leaves the square. */
    onHover?: (hovered: boolean) => void
    /** Left click, Enter or Space (a real button). */
    onClick?: (e: MouseEvent) => void
    /** Right click or the ContextMenu key. */
    onContextMenu?: (e: MouseEvent) => void
    /** A legend swatch: same glyph and tier colour, but plain text — not focusable, not clickable. */
    static?: boolean
    class?: string
}

/**
 * One heatmap square, typed at the app's mono cell size. In the grid it is a `PlainButton`, so
 * Tab reaches it and Enter/Space activate it; hover and focus both report through `onHover`, so
 * a keyboard user sees the same readout a pointer does. `static` renders the legend swatch as
 * plain text with the identical tier colours.
 */
const HeatCell: Component<HeatCellProps> = props => {
    const tier = () => styles[`lv${props.level}`]
    return (
        <Show
            when={!props.static}
            fallback={
                <Text
                    as="span"
                    inherit
                    class={`${styles.cell} ${tier()} ${props.class ?? ''}`}
                >
                    {props.glyph}
                </Text>
            }
        >
            <PlainButton
                class={`${styles.cell} ${styles.interactive} ${tier()} ${props.class ?? ''}`}
                classList={{ [styles.selected]: props.selected }}
                data-bucket={props.date}
                data-hovered={props.hovered ? '' : undefined}
                aria-label={props.label}
                aria-pressed={props.selected === undefined ? undefined : props.selected}
                onPointerEnter={() => props.onHover?.(true)}
                onPointerLeave={() => props.onHover?.(false)}
                onFocus={() => props.onHover?.(true)}
                onBlur={() => props.onHover?.(false)}
                onClick={e => props.onClick?.(e)}
                onContextMenu={e => props.onContextMenu?.(e)}
            >
                <Text as="span" inherit>
                    {props.glyph}
                </Text>
            </PlainButton>
        </Show>
    )
}

export default HeatCell
