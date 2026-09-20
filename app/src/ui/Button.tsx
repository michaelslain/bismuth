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
    state?: ButtonState
    size?: ButtonSize
    danger?: boolean
    /** Selected + a glow rim — the view's one emphasized action. See buttonClass.ts. */
    primary?: boolean
    /** Renders the "[ label ]" CLI-confirm look — lowercase text wrapped in brackets. Replaces
     *  the `::before`/`::after` reach into `:global(.btn--text)` that Toast and the chat cards
     *  used to reimplement themselves. Text buttons only. */
    bracket?: boolean
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Internal base button: owns the shared .btn chrome. App code should import
 * TextButton / IconButton, not this directly.
 */
function Button(props: ButtonProps) {
    const [local, rest] = splitProps(props, [
        'kind',
        'state',
        'size',
        'danger',
        'primary',
        'bracket',
        'class',
        'type',
        'children',
    ])
    return (
        <button
            type={local.type ?? 'button'}
            class={buttonClass({
                kind: local.kind,
                state: local.state,
                size: local.size,
                danger: local.danger,
                primary: local.primary,
                class: [
                    local.bracket ? styles.bracket : '',
                    local.class,
                ]
                    .filter(Boolean)
                    .join(' '),
            })}
            {...rest}
        >
            {local.children}
        </button>
    )
}

export default Button
export { Button }
