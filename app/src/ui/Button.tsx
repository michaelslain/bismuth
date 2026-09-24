import { splitProps, type JSX } from 'solid-js'
import {
    buttonClass,
    type ButtonKind,
    type ButtonState,
    type ButtonSize,
} from './buttonClass'
import styles from './Button.module.css'

export type { ButtonKind, ButtonState, ButtonSize }

export type ButtonProps = {
    kind?: ButtonKind
    /** Also rendered as `data-state` on the root element (defaulting to `'normal'`) — the runtime
     *  hook outside callers select on (`.x[data-state="selected"]`) instead of reaching
     *  `:global(.btn--selected)` etc. See one-global-followups Task 1. */
    state?: ButtonState
    /** Ignored for `kind="text"` — every text button is one size. Still applies to `icon`/`segment`. */
    size?: ButtonSize
    danger?: boolean
    /** Selected + a glow rim — the view's one emphasized action. See buttonClass.ts. */
    primary?: boolean
    /** Colour for the selected state (a `var(--…)` token or a token-derived value). Sets
     *  `--btn-accent` on the root, read by `.btn--text.btn--selected` in place of `--accent`. */
    accent?: string
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Internal base button: owns the shared .btn chrome. App code should import
 * TextButton / IconButton, not this directly.
 *
 * `kind="text"` (the default) renders as `[ label ]` — the bracket look is unconditional now,
 * not an opt-in prop. `kind="segment"` is the OLD text look, kept verbatim for SegmentedToggle.
 */
function Button(props: ButtonProps) {
    const [local, rest] = splitProps(props, [
        'kind',
        'state',
        'size',
        'danger',
        'primary',
        'accent',
        'class',
        'type',
        'style',
        'children',
    ])
    const kind = () => local.kind ?? 'text'
    const style = (): JSX.CSSProperties | string | undefined => {
        if (!local.accent) return local.style
        if (typeof local.style === 'string') {
            return `${local.style};--btn-accent:${local.accent}`
        }
        return { ...local.style, '--btn-accent': local.accent }
    }
    return (
        <button
            type={local.type ?? 'button'}
            data-state={local.state ?? 'normal'}
            data-kind={kind()}
            data-size={
                local.size && local.size !== 'md' && kind() !== 'text'
                    ? local.size
                    : undefined
            }
            data-danger={local.danger ? '' : undefined}
            data-primary={local.primary ? '' : undefined}
            class={buttonClass({
                kind: local.kind,
                state: local.state,
                size: local.size,
                danger: local.danger,
                primary: local.primary,
                class: local.class,
            })}
            style={style()}
            {...rest}
        >
            {kind() === 'text' ? (
                <span class={styles.textLabel}>{local.children}</span>
            ) : (
                local.children
            )}
        </button>
    )
}

export default Button
export { Button }
