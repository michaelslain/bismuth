import type { Component, JSX } from 'solid-js'
import './ui.css'
import './ChipToggle.module.css'

export type ChipToggleTone = 'teal' | 'blue' | 'violet' | 'green' | 'gold' | 'rose'

export type ChipToggleProps = {
    selected?: boolean
    onToggle?: () => void
    /** Tints the SELECTED state to a category color (14% fill / 45% border) instead of
     *  the default accent. Unset = accent. */
    tone?: ChipToggleTone
    class?: string
    children: JSX.Element
}

/**
 * A selectable pill toggle — export options, search toggles. `.chip-toggle` (+ `.selected`,
 * `.tone-<x>`) is currently a `:global()` bridge in ChipToggle.module.css, still reached
 * directly by bases/CardEditModal.module.css and bases/BaseView.module.css; see that file's
 * header.
 */
const ChipToggle: Component<ChipToggleProps> = props => {
    return (
        <button
            type="button"
            class={[
                'chip-toggle',
                props.selected ? 'selected' : '',
                props.tone ? `tone-${props.tone}` : '',
                props.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
            aria-pressed={!!props.selected}
            onClick={() => props.onToggle?.()}
        >
            {props.children}
        </button>
    )
}

export default ChipToggle
