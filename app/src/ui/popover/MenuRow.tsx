// app/src/ui/popover/MenuRow.tsx
// One popover row: [icon] label [detail]. Pure presentation — no positioning,
// no event wiring beyond the click/hover the parent passes in. Shared by the
// context menu; the autocomplete reproduces the SAME anatomy via CodeMirror's
// addToOptions (see editor/completionDisplay.ts), reading the same CSS classes.
//
// When states stack, the INK and the FILL are decided separately, on purpose. `--selected` paints
// the fill (--accent-soft) and `--disabled`/`--danger` paint the ink, and the ink rules are
// declared after `--selected` in global.css, so they win the colour: a selected delete row is
// red text on the accent wash (still reads as destructive, still shows the keyboard cursor), a
// selected disabled row is muted text on the wash. The stories pin both (selected+danger,
// selected+disabled) so a reorder in global.css cannot flip it silently.
import { Show, type JSX } from 'solid-js'
import { Icon } from '../../icons/Icon'
import Kbd from '../ascii/Kbd'
import iconSize from '../iconSize'

/** A glyph's drawn ink stops short of its box: Phosphor's chevron leaves ~3.5px of empty box
 *  on the right at the 12px icon size (29% of it), so the chevron's ink ended inside the trailing
 *  edge the shortcut and detail columns end on. Pulled out by that padding, in proportion to the
 *  configured icon size. */
const GLYPH_TRAILING_PAD = 3.5 / 12

function MenuRow(props: {
    label: string
    icon?: string
    prefix?: JSX.Element
    /** Descriptive text for the row (a path, a count, a hint) — NOT a keybinding: that is
     *  `shortcut`, which renders the caps at the Kbd size instead of the text size. */
    detail?: string
    /** A real keybinding combo — see PopoverRow.shortcut. Renders right-aligned via Kbd. */
    shortcut?: string
    danger?: boolean
    disabled?: boolean
    selected?: boolean
    /** Render a right-side chevron marking a nested submenu. */
    hasSubmenu?: boolean
    /** Appended to the row's own root class, so a caller can style one instance without a
     *  `:global(.bismuth-popover-row)` reach. */
    class?: string
    /** Appended to the detail span's class — e.g. a caller that wants the detail text mono. */
    detailClass?: string
    onClick?: (e: MouseEvent) => void
    onMouseEnter?: () => void
}): JSX.Element {
    return (
        <div
            class={`bismuth-popover-row ${props.class ?? ''}`}
            data-popover-row=""
            classList={{
                'bismuth-popover-row--selected': props.selected,
                'bismuth-popover-row--danger': props.danger,
                'bismuth-popover-row--disabled': props.disabled,
            }}
            onMouseEnter={() => props.onMouseEnter?.()}
            onClick={e => !props.disabled && props.onClick?.(e)}
        >
            <Show when={props.prefix}>
                <span class="bismuth-popover-prefix">{props.prefix}</span>
            </Show>
            <Show when={props.icon}>
                <span class="bismuth-popover-icon">
                    <Icon value={props.icon!} />
                </span>
            </Show>
            <span class="bismuth-popover-label">{props.label}</span>
            <Show when={props.detail}>
                <span class={`bismuth-popover-detail ${props.detailClass ?? ''}`}>
                    {props.detail}
                </span>
            </Show>
            {/* A row's keybinding recedes to --faint (Kbd's `muted`), as in every palette row. */}
            <Show when={props.shortcut}>
                <span class="bismuth-popover-shortcut">
                    <Kbd combo={props.shortcut} muted />
                </span>
            </Show>
            <Show when={props.hasSubmenu}>
                <span
                    class="bismuth-popover-chev"
                    style={{ 'margin-right': `${-iconSize() * GLYPH_TRAILING_PAD}px` }}
                >
                    <Icon value="ChevronRight" />
                </span>
            </Show>
        </div>
    )
}

export default MenuRow
