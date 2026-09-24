import { splitProps, type JSX } from 'solid-js'
import { Button } from './Button'
import { Icon } from '../icons/Icon'
import { isIconName } from '../icons/registry'
import { warnBadIcon } from './devWarn'
import { useIconBar } from './iconBarContext'
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
    /** Icon pixel size. Defaults to the enclosing IconBar's, else the app's one icon size (ui/iconSize.ts); app code never passes it. */
    iconSize?: number
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>

/**
 * Icon-only button. Icons must come from the icon set (via the icon
 * registry) — passing a literal glyph/emoji warns in dev.
 * "normal" renders full-opacity; "unselected" is the same dimmed; "selected" is highlighted.
 */
function IconButton(props: IconButtonProps) {
    const [local, rest] = splitProps(props, [
        'icon',
        'label',
        'variant',
        'size',
        'iconSize',
        'title',
    ])
    if (import.meta.env?.DEV && !isIconName(local.icon)) {
        warnBadIcon('IconButton', local.icon)
    }
    // Read an enclosing IconBar (toolbar-iconbar plan) for the toolbar box + glyph size — a plain
    // Solid context read, never a class selector. `bar` is undefined outside any bar, so every
    // default below falls through to the standalone behaviour unchanged. An explicit
    // `size`/`iconSize` prop on THIS button still wins over the bar.
    const bar = useIconBar()
    const size = () => local.size ?? (bar ? 'sm' : undefined)
    // Undefined outside a bar falls through to Icon's own default: the app's one icon size.
    const iconSize = () => local.iconSize ?? bar?.iconSize()
    return (
        <Button
            kind="icon"
            state={local.variant ?? 'normal'}
            size={size()}
            aria-label={local.label}
            title={local.title ?? local.label}
            {...rest}
        >
            <Icon value={local.icon} size={iconSize()} />
        </Button>
    )
}

export default IconButton
export { IconButton }
