import { splitProps, createEffect, type JSX } from 'solid-js'
import { Button } from './Button'
import type { ButtonState, ButtonSize } from './buttonClass'
import { warnLabelCase } from './devWarn'

/** Selection state — see buttonClass.ts. "normal" = standalone button. */
export type TextButtonVariant = ButtonState

export type TextButtonProps = {
    /** "normal" (standalone, default) | "selected" | "unselected" (toggle/series member). */
    variant?: TextButtonVariant
    /** Destructive tone (e.g. Delete) — orthogonal to variant. */
    danger?: boolean
    /** Selected + a glow rim — the view's one emphasized action. At most one per view. */
    primary?: boolean
    /** @deprecated ignored — every text button is bracketed; removed in Task 6 */
    size?: ButtonSize
    /** @deprecated ignored — every text button is bracketed; removed in Task 6 */
    bracket?: boolean
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Text-label button. The default app button — always renders `[ label ]`.
 *
 * Standardization rules this component enforces:
 *  • Labels are lowercase — pass already-lowercase text (no hidden CSS
 *    transform; what you pass is what shows). Non-lowercase input warns in dev.
 *  • Appearance comes from `variant` (selection state) only — call sites pass
 *    layout (flex/margin/position) via `style`, never colors/borders/padding.
 *  • `size`/`bracket` are deprecated and ignored — every text button is one
 *    size and every text button is `[ label ]`.
 */
function TextButton(props: TextButtonProps) {
    const [local, rest] = splitProps(props, ['variant', 'size', 'bracket'])
    if (import.meta.env?.DEV) {
        createEffect(() => warnLabelCase('TextButton', rest.children))
    }
    return <Button kind="text" state={local.variant ?? 'normal'} {...rest} />
}

export default TextButton
export { TextButton }
