// app/src/ui/Swatch.tsx
// A colour square button — the picker option and the current-colour chip CategoryPanel used to
// hand-roll as two bare <button>s (.cat-sw / .cat-chip) differing only in size.
//
// `label` is the accessible name: a swatch has no text, so without it a screen reader announces
// a bare "button" and a keyboard user cannot tell the colours apart. The type enforces it: an
// interactive swatch (the default, `static` unset/false) REQUIRES both `label` and `onClick`; a
// `static` swatch (a decorative colour dot with no action of its own — e.g. ExportView's theme
// indicator) may omit both and renders `aria-hidden` unless `label` is given.
import { type Component, Show } from 'solid-js'
import styles from './Swatch.module.css'

export type SwatchProps = (
    | { static?: false; label: string; onClick: () => void }
    | { static: true; label?: string; onClick?: never }
) & {
    /** Any CSS colour — a resolved value, or a `var(--token)` reference. */
    color: string
    selected?: boolean
    /** "md" (22px, a picker option, default) | "sm" (20px, the row's current-colour chip). */
    size?: 'sm' | 'md'
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
