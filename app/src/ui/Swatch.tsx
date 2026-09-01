// app/src/ui/Swatch.tsx
// A colour square button — the picker option and the current-colour chip CategoryPanel used to
// hand-roll as two bare <button>s (.cat-sw / .cat-chip) differing only in size.
//
// `label` is required and becomes the accessible name: a swatch has no text, so without it a
// screen reader announces a bare "button" and a keyboard user cannot tell the colours apart.
import { type Component } from 'solid-js'
import styles from './Swatch.module.css'

export type SwatchProps = {
    /** Any CSS colour — a resolved value, or a `var(--token)` reference. */
    color: string
    selected?: boolean
    /** Required accessible name (the colour's name) — sets aria-label and title. */
    label: string
    /** "md" (22px, a picker option, default) | "sm" (20px, the row's current-colour chip). */
    size?: 'sm' | 'md'
    onClick: () => void
    class?: string
}

const Swatch: Component<SwatchProps> = props => (
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
        onClick={() => props.onClick()}
    />
)

export default Swatch
export { Swatch }
