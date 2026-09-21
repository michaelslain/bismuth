import { For, type JSX } from 'solid-js'
import { Button, type ButtonSize } from './Button'
import styles from './SegmentedToggle.module.css'

export type SegmentedOption<T> = {
    id: T
    label: JSX.Element
    title?: string
    disabled?: boolean
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
}

/**
 * A row of mutually-exclusive buttons: the active one is `selected`, the rest
 * `unselected`. This is THE canonical selected/unselected consumer — graph mode
 * + 2D/3D rows, the calendar view switcher, and BaseView's tabs.
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
                        kind="text"
                        state={
                            opt.id === props.value ? 'selected' : 'unselected'
                        }
                        size={props.size}
                        class={props.segmentClass}
                        title={opt.title}
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
