import { splitProps, type JSX } from 'solid-js'
import { Button } from './Button'
import { Icon } from '../icons/Icon'
import { isIconName } from '../icons/registry'
import { warnBadIcon } from './devWarn'
import type { ButtonState, ButtonSize } from './buttonClass'

/** Selection state — see buttonClass.ts. "normal" = standalone, full opacity. */
export type IconButtonVariant = ButtonState

export type IconButtonProps = {
    /** icon name (any casing / Li-Lu legacy). Must resolve to an icon — not a literal glyph or emoji. */
    icon: string
    /** Required accessible label — sets aria-label and title. */
    label: string
    /** "normal" (standalone, default) | "selected" | "unselected" (toggle/series member). */
    variant?: IconButtonVariant
    /** Destructive tone — orthogonal to variant. */
    danger?: boolean
    size?: ButtonSize
    /** Icon pixel size (default 16). */
    iconSize?: number
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>

/**
 * Icon-only button. Icons must come from the icon set (via the icon
 * registry) — passing a literal glyph/emoji warns in dev.
 * "normal" renders full-opacity; "unselected" is the same dimmed; "selected" is highlighted.
 */
/**
 * Default glyph size — the app-wide `--icon` token (visual-unification audit §9.5: "we should
 * just have one size i feel no?"). Was 12 (2026-07-29 rationale: sit with the 11.5px --fs-ui
 * text rather than the old 16px default) until the 2026-08-27 audit found SIX different row-icon
 * sizes in the wild (12/13/14/15/16/18) and picked 14 — the median and most-used value — as the
 * ONE size for every icon in chrome, rows, menus, buttons, badges and chevrons. No --icon-sm/-lg
 * exist; a genuinely oversized empty-state mark sets its own literal at the call site instead.
 * Kept as a plain number, not `var(--icon)`, because this feeds a Solid inline style's `size`
 * prop (a JS number, not a CSS length) — the two must be changed together if `--icon` ever moves.
 */
export const ICON_PX = 14

function IconButton(props: IconButtonProps) {
    const [local, rest] = splitProps(props, [
        'icon',
        'label',
        'variant',
        'iconSize',
        'title',
    ])
    if (import.meta.env?.DEV && !isIconName(local.icon)) {
        warnBadIcon('IconButton', local.icon)
    }
    return (
        <Button
            kind="icon"
            state={local.variant ?? 'normal'}
            aria-label={local.label}
            title={local.title ?? local.label}
            {...rest}
        >
            <Icon value={local.icon} size={local.iconSize ?? ICON_PX} />
        </Button>
    )
}

export default IconButton
export { IconButton }
