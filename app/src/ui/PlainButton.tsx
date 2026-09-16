import { splitProps, type JSX } from 'solid-js'
import styles from './PlainButton.module.css'

export type PlainButtonProps = Omit<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    'type'
> & { class?: string }

/**
 * An unstyled `<button>` — always `type="button"`, with a reset that removes every native
 * button chrome (appearance, background, border, padding, margin, font, color, alignment,
 * cursor). Everything visual comes from the caller's `class`. Distinct from
 * TextButton/IconButton (`.btn` chrome + uppercase labels) and OptionRow (a fixed two-line
 * choice row) — this is for a caller that already owns its own look and only wants a real
 * `<button>` underneath it (click semantics, keyboard focus, `disabled`).
 */
function PlainButton(props: PlainButtonProps) {
    const [local, rest] = splitProps(props, ['class'])
    return (
        <button
            type="button"
            class={`${styles['plain-button']} ${local.class ?? ''}`}
            {...rest}
        />
    )
}

export default PlainButton
export { PlainButton }
