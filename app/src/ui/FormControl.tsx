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
 * The shared form-control chrome — surface fill, soft border, accent focus ring — behind both
 * TextInput and Select's trigger. Polymorphic: `as="input"`/`"textarea"` is what TextInput
 * composes, `as="button"` is what Select's trigger composes. The chrome itself stays the plain
 * global `.ui-input`/`.ui-select-trigger` class (see FormControl.module.css), not a hashed
 * module local — seven stylesheets outside ui/ and three literal writers still reach those class
 * names directly, and wave 3 of this plan is what migrates them onto the real components.
 */
function FormControl(props: FormControlProps) {
    const [local, rest] = splitProps(props, ['as', 'class', 'children'])
    const cls = () => `${styles.control} ui-input ${local.class ?? ''}`.trim()
    if (local.as === 'textarea') {
        return (
            <textarea
                class={cls()}
                {...(rest as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
        )
    }
    if (local.as === 'button') {
        return (
            <button
                class={cls()}
                {...(rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>)}
            >
                {local.children}
            </button>
        )
    }
    return (
        <input class={cls()} {...(rest as JSX.InputHTMLAttributes<HTMLInputElement>)} />
    )
}

export default FormControl
