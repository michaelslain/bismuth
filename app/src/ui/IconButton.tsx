import { Show, splitProps, type JSX } from 'solid-js'
import Text from './Text'
import { Button } from './Button'
import { Icon } from '../icons/Icon'
import { isIconName } from '../icons/registry'
import { warnBadIcon } from './devWarn'
import { useIconBar } from './iconBarContext'
import { pressedFor } from './pressedFor'
import type { ButtonState, ButtonSize } from './buttonClass'

/** Selection state — see buttonClass.ts. "normal" = standalone, full opacity. */
export type IconButtonVariant = ButtonState

export type IconButtonProps = {
    /** icon name (any casing / Li-Lu legacy). Must resolve to an icon — not a literal glyph or emoji. */
    icon?: string
    /** Text glyph drawn in place of the icon (the match-case `Aa`): same bracket recipe, in the
     *  surrounding text font and size. Give `icon` or `glyph`, not both. */
    glyph?: string
    /** Required accessible label — sets aria-label and the hover name (`data-tooltip`, shown by TooltipHost). */
    label: string
    /** "normal" (standalone, default) | "selected" | "unselected" (toggle/series member). */
    variant?: IconButtonVariant
    /** Destructive tone — orthogonal to variant. `'hover'`: `--faint` at rest, `--danger` on hover. */
    danger?: boolean | 'hover'
    size?: ButtonSize
    /** Member of a pick-one group (exactly one member is ever `selected`): an `unselected` member
     *  draws no bracket space, so the gaps around the one `[▣]` match the gaps between bare glyphs.
     *  Leave it off for a lone on/off toggle — there the reserved space keeps neighbours still. */
    pickOne?: boolean
    /** Icon pixel size. Defaults to the enclosing IconBar's, else the app's one icon size (ui/iconSize.ts); app code never passes it. */
    iconSize?: number
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>

/**
 * Icon-only button. Icons must come from the icon set (via the icon
 * registry) — passing a literal glyph/emoji warns in dev.
 * `selected`/`unselected` set `aria-pressed` from the variant (a caller's own `aria-pressed` wins).
 * "normal" renders full-opacity; "unselected" is the same dimmed; "selected" is highlighted.
 */
function IconButton(props: IconButtonProps) {
    const [local, rest] = splitProps(props, [
        'icon',
        'glyph',
        'label',
        'variant',
        'size',
        'iconSize',
        'title',
    ])
    if (import.meta.env?.DEV && local.icon !== undefined && !isIconName(local.icon)) {
        warnBadIcon('IconButton', local.icon ?? '')
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
            data-tooltip={local.title ?? local.label}
            aria-pressed={pressedFor(local.variant)}
            data-glyph={local.glyph ? '' : undefined}
            {...rest}
        >
            <Show
                when={local.glyph}
                fallback={<Icon value={local.icon ?? ''} size={iconSize()} />}
            >
                <Text as="span" inherit>
                    {local.glyph}
                </Text>
            </Show>
        </Button>
    )
}

export default IconButton
export { IconButton }
