// app/src/ui/Stars.tsx
// Five-star rating, typed: a run of `*` glyphs, filled --gold up to `value`,
// faint for the remainder. Canonical across Bases (table/cards/list/kanban)
// and anywhere else ratings show.
import { For } from 'solid-js'
import './ui.css'

function Stars(props: { value: number; max?: number; size?: number }) {
    const max = () => props.max ?? 5
    const score = () => Math.max(0, Math.min(max(), Math.round(props.value)))
    return (
        <span class="stars" style={{ 'font-size': `${props.size ?? 13}px` }}>
            <For each={Array.from({ length: max() }, (_, i) => i + 1)}>
                {i => (
                    <span class={i <= score() ? 'star-on' : undefined}>*</span>
                )}
            </For>
        </span>
    )
}

export default Stars
