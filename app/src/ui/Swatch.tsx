// app/src/ui/Swatch.tsx
// A colour square button — the picker option and the current-colour chip CategoryPanel used to
// hand-roll as two bare <button>s (.cat-sw / .cat-chip) differing only in size.
//
// `label` is the accessible name: a swatch has no text, so without it a screen reader announces
// a bare "button" and a keyboard user cannot tell the colours apart. It stays required in
// practice for the interactive default; a `static` swatch (a decorative colour dot with no
// action of its own — e.g. ExportView's theme indicator) may omit it and renders `aria-hidden`
// instead.
import { type Component, Show } from 'solid-js'
import styles from './Swatch.module.css'

export type SwatchProps = {
    /** Any CSS colour — a resolved value, or a `var(--token)` reference. */
    color: string
    selected?: boolean
    /** Accessible name (the colour's name) — sets aria-label and title. Required unless
     *  `static` is set. */
    label?: string
    /** "md" (22px, a picker option, default) | "sm" (20px, the row's current-colour chip). */
    size?: 'sm' | 'md'
    /** Non-interactive variant: renders a plain, non-focusable `<div>` instead of a `<button>` —
     *  no onClick, no aria-pressed. `aria-hidden` unless `label` is given (a decorative swatch
     *  has no accessible name of its own). */
    static?: boolean
    onClick?: () => void
    class?: string
}

const Swatch: Component<SwatchProps> = props => (
    <Show
        when={!props.static}
        fallback={
            <div
                class={styles['swatch']}
                classList={{
                    [styles['sm']!]: props.size === 'sm',
                    [styles['selected']!]: !!props.selected,
                    [styles['static']!]: true,
                    [props.class ?? '']: !!props.class,
                }}
                style={{ background: props.color }}
                aria-label={props.label}
                aria-hidden={props.label ? undefined : 'true'}
                title={props.label}
            />
        }
    >
        <button
            type="button"
            class={styles['swatch']}
            classList={{
                [styles['sm']!]: props.size === 'sm',
                [styles['selected']!]: !!props.selected,
                [props.class ?? '']: !!props.class,
            }}
            style={{ background: props.color }}
            aria-label={props.label}
            aria-pressed={props.selected ? 'true' : undefined}
            title={props.label}
            onClick={() => props.onClick?.()}
        />
    </Show>
)

export default Swatch
export { Swatch }
