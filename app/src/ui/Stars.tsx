// app/src/ui/Stars.tsx
// Five-star rating, typed: a run of `*` glyphs, filled --gold up to `value`,
// faint for the remainder. Canonical across Bases (table/cards/list/kanban)
// and anywhere else ratings show.
import { For } from 'solid-js'
import styles from './Stars.module.css'
import { clamp } from '../math'

function Stars(props: { value: number; max?: number; size?: number }) {
    const max = () => props.max ?? 5
    const score = () => clamp(Math.round(props.value), 0, max())
    return (
        <span class={styles.stars} style={{ 'font-size': `${props.size ?? 13}px` }}>
            <For each={Array.from({ length: max() }, (_, i) => i + 1)}>
                {i => (
                    <span class={i <= score() ? styles['star-on'] : undefined}>*</span>
                )}
            </For>
        </span>
    )
}

export default Stars
