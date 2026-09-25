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
    /** 'icon': every option renders as a `kind="icon"` bracket — the same square, borderless
     *  look `IconButton` uses, `--sp-1` apart — for icon-only groups (the drawing dock's tool/
     *  colour/size/smoothing/paper/undo-redo rows). Default (omitted, 'bracket'): each option
     *  renders as a `kind="text"` bracket button, `--sp-4` apart — the same `[label]` control as
     *  everywhere else in the app. `size` is honoured for `look="icon"`; Button itself ignores
     *  it for `kind="text"`. */
    look?: 'icon'
}

/**
 * A row of mutually-exclusive buttons: the active one is `selected`, the rest
 * `unselected`. This is THE canonical selected/unselected consumer — graph mode
 * + 2D/3D rows, the calendar view switcher, BaseView's tabs, and the drawing dock's
 * icon-only tool/colour groups.
 *
 * The default renders every option as `kind="text"` — the same `[label]` bracket button as
 * everywhere else in the app. `look="icon"` renders `kind="icon"` instead — the same square,
 * borderless bracket `IconButton` uses. Either way, selected-state colour, the brackets
 * themselves, and the no-box treatment all come from Button's own CSS
 * (`.btn--text.btn--selected` / `.btn--icon.btn--selected`, Button.module.css) — this component
 * owns none of that any more.
 */
function SegmentedToggle<T>(props: SegmentedToggleProps<T>) {
    const kind = () => (props.look === 'icon' ? 'icon' : 'text')
    return (
        <div
            class={`${styles.segmented} ${props.class ?? ''}`}
            data-look={props.look ?? 'bracket'}
            data-segmented=""
        >
            <For each={props.options}>
                {opt => (
                    <Button
                        kind={kind()}
                        state={
                            opt.id === props.value ? 'selected' : 'unselected'
                        }
                        size={props.size}
                        aria-pressed={
                            kind() === 'text'
                                ? opt.id === props.value
                                : undefined
                        }
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
