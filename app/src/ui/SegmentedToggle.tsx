import { For, type JSX } from 'solid-js'
import { Button, type ButtonSize } from './Button'
import styles from './SegmentedToggle.module.css'

export type SegmentedOption<T> = {
    id: T
    label: JSX.Element
    title?: string
    disabled?: boolean
    /** Extra class merged onto this option's Button, alongside `segmentClass`. */
    class?: string
    /** Rendered as `aria-label` on this option's Button. `title` stays as-is. */
    ariaLabel?: string
}

export type SegmentedToggleProps<T> = {
    options: SegmentedOption<T>[]
    /** `undefined` for a group with no selected segment — e.g. undo/redo, which are two
     *  independent commands rather than a mutually-exclusive pair with an active member. */
    value: T | undefined
    onChange: (id: T) => void
    size?: ButtonSize
    class?: string
    /** Per-segment extra class (e.g. an underline-tab look). */
    segmentClass?: string
    /** 'bracket' (default) or 'segment' (butted boxes) — pre-registered for bracket-toggles Task 1. */
    look?: 'bracket' | 'segment'
}

/**
 * A row of mutually-exclusive buttons: the active one is `selected`, the rest
 * `unselected`. This is THE canonical selected/unselected consumer — graph mode
 * + 2D/3D rows, the calendar view switcher, and BaseView's tabs.
 *
 * Renders `kind="segment"` — the OLD `kind="text"` look (uppercase, bordered, sized), kept
 * verbatim so this component's pixels don't move when `kind="text"` becomes the bracket look.
 */
function SegmentedToggle<T>(props: SegmentedToggleProps<T>) {
    return (
        // `styles.wrap` is a no-op marker local (see SegmentedToggle.module.css) — without a
        // real local class referenced from here, the module has zero locals and Rollup
        // tree-shakes its whole CSS output, same trap as ui/FormControl.module.css.
        <div class={`segmented ${styles.wrap} ${props.class ?? ''}`}>
            <For each={props.options}>
                {opt => (
                    <Button
                        kind="segment"
                        state={
                            opt.id === props.value ? 'selected' : 'unselected'
                        }
                        size={props.size}
                        class={`${props.segmentClass ?? ''} ${opt.class ?? ''}`}
                        title={opt.title}
                        aria-label={opt.ariaLabel}
                        disabled={opt.disabled}
                        onClick={() => props.onChange(opt.id)}
                    >
                        {opt.label}
                    </Button>
                )}
            </For>
        </div>
    )
}

export default SegmentedToggle
export { SegmentedToggle }
