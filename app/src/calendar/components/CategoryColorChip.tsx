// A category's colour: the category-palette chip (ui/ColorChip) with the category's own dot as its
// trigger. The three places that draw one — CategoryList's rows, NewCategoryForm's colour slot and
// TaskCalendarSettings' category rows — each used to hand-assemble ColorChip + StatusDot + the
// palette-fallback colour, so the dot's size and the "no colour yet reads as the accent" rule lived
// in three copies. The swatches themselves are the theme tokens centralized in core's tokens.ts
// (via ui/palette), never colours invented here.
import type { Component } from 'solid-js'
import ColorChip from '../../ui/ColorChip'
import StatusDot from '../../ui/StatusDot'
import { resolvePaletteColor } from '../../ui/palette'
import styles from './CategoryColorChip.module.css'

export type CategoryColorChipProps = {
    /** The stored colour: a palette token name, a resolved `var(--token)`, or empty (reads as the
     *  accent, so a category that has no colour yet still shows a dot). */
    color: string
    /** Whether the palette popover is open. The caller owns which chip's it is. */
    open: boolean
    onToggle: () => void
    /** The palette entry picked, verbatim. */
    onPick: (token: string) => void
    class?: string
}

// NOTE: props are read whole, never destructured — a destructured `color` would freeze at mount.
const CategoryColorChip: Component<CategoryColorChipProps> = props => (
    <ColorChip
        class={`${styles.chip} ${props.class ?? ''}`}
        color={props.color}
        trigger={
            <StatusDot
                size="md"
                color={resolvePaletteColor(props.color) || 'var(--accent)'}
            />
        }
        open={props.open}
        onToggle={() => props.onToggle()}
        onPick={token => props.onPick(token)}
    />
)

export default CategoryColorChip
