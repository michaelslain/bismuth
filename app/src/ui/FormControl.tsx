import { splitProps, type JSX } from 'solid-js'
import styles from './FormControl.module.css'

export type FormControlProps =
    | ({ as: 'input'; class?: string } & Omit<
          JSX.InputHTMLAttributes<HTMLInputElement>,
          'class'
      >)
    | ({ as: 'textarea'; class?: string } & Omit<
          JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
          'class'
      >)
    | ({ as: 'button'; class?: string; children?: JSX.Element } & Omit<
          JSX.ButtonHTMLAttributes<HTMLButtonElement>,
          'class' | 'children'
      >)

/**
 * The shared form-control chrome — transparent, an underline rule, accent underline + inset
 * shadow on focus, no fill and no box — behind both TextInput and Select's trigger. Polymorphic:
 * `as="input"`/`"textarea"` is what TextInput composes, `as="button"` is what Select's trigger
 * composes. The chrome is `styles['ui-input']`, FormControl's own hashed local (see
 * FormControl.module.css) — no other stylesheet reaches it anymore.
 */
function FormControl(props: FormControlProps) {
    const [local, rest] = splitProps(props, ['as', 'class', 'children'])
    const cls = () => `${styles['ui-input']} ${local.class ?? ''}`.trim()
    if (local.as === 'textarea') {
        return (
            <textarea
                class={cls()}
                data-control={local.as}
                {...(rest as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
        )
    }
    if (local.as === 'button') {
        return (
            <button
                class={cls()}
                data-control={local.as}
                {...(rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>)}
            >
                {local.children}
            </button>
        )
    }
    return (
        <input
            class={cls()}
            data-control={local.as}
            {...(rest as JSX.InputHTMLAttributes<HTMLInputElement>)}
        />
    )
}

export default FormControl
