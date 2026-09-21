import type { Component, JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import styles from './ChipToggle.module.css'

export type ChipToggleTone = 'teal' | 'blue' | 'violet' | 'green' | 'gold' | 'rose'

export type ChipToggleProps = {
    selected?: boolean
    onToggle?: () => void
    /** Tints the SELECTED state to a category color (14% fill / 45% border) instead of
     *  the default accent. Unset = accent. */
    tone?: ChipToggleTone
    class?: string
    children: JSX.Element
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>

/**
 * A selectable pill toggle — export options, search toggles. `.chip-toggle` (+ `.selected`,
 * `.tone-<x>`) is currently a `:global()` bridge in ChipToggle.module.css, still reached
 * directly by bases/CardEditModal.module.css and bases/BaseView.module.css; see that file's
 * header. Remaining native button attributes (`title`, `aria-*`, …) pass through via
 * `splitProps` onto the underlying `<button>`.
 */
const ChipToggle: Component<ChipToggleProps> = props => {
    const [local, rest] = splitProps(props, [
        'selected',
        'onToggle',
        'tone',
        'class',
        'children',
    ])
    return (
        <button
            type="button"
            {...rest}
            class={[
                styles['chip-toggle-marker'],
                'chip-toggle',
                local.selected ? 'selected' : '',
                local.tone ? `tone-${local.tone}` : '',
                local.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
            aria-pressed={!!local.selected}
            onClick={() => local.onToggle?.()}
        >
            {local.children}
        </button>
    )
}

export default ChipToggle
