import { splitProps, createEffect, type JSX } from 'solid-js'
import { Button } from './Button'
import { Icon } from '../icons/Icon'
import { isIconName } from '../icons/registry'
import { warnBadIcon, warnLabelCase } from './devWarn'
import type { ButtonState } from './buttonClass'

/** Selection state — see buttonClass.ts. "normal" = standalone button. */
export type IconTextButtonVariant = ButtonState

export type IconTextButtonProps = {
    /** icon name (rendered before the label). Must resolve to an icon. */
    icon: string
    /** Icon pixel size. Defaults to the app's one icon size (ui/iconSize.ts); app code never passes it. */
    iconSize?: number
    /** "normal" (standalone, default) | "selected" | "unselected" (toggle/series member). */
    variant?: IconTextButtonVariant
    /** Destructive tone — orthogonal to variant. */
    danger?: boolean
    /** Accent + bold, no box — the view's one emphasized action. At most one per view. */
    primary?: boolean
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Icon + text button — the combination of IconButton and TextButton. Shares the
 * `.btn` family chrome (so it gets the app Monaspace font and hover/selected states),
 * with a leading icon, rendered as `[ icon label ]` — the same bracket register as
 * TextButton wraps both in `.label`, whose gap spaces them.
 *
 * Labels are lowercase (same rule as TextButton) — pass already-lowercase text.
 */
function IconTextButton(props: IconTextButtonProps) {
    const [local, rest] = splitProps(props, [
        'icon',
        'iconSize',
        'variant',
        'children',
    ])
    if (import.meta.env?.DEV && !isIconName(local.icon)) {
        warnBadIcon('IconTextButton', local.icon)
    }
    if (import.meta.env?.DEV) {
        createEffect(() => warnLabelCase('IconTextButton', local.children))
    }
    return (
        <Button kind="text" state={local.variant ?? 'normal'} {...rest}>
            <Icon value={local.icon} size={local.iconSize} />
            {local.children}
        </Button>
    )
}

export default IconTextButton
export { IconTextButton }
