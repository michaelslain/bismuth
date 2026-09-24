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
    /** 'bracket' (default): each option is a borderless `[label]` bracket button, `--sp-4`
     *  apart, `size` ignored. 'segment' (butted boxes, text): today's boxed look, `size`
     *  honoured. 'icon' (butted boxes, icon glyphs): selected is an accent glyph on
     *  `--accent-soft` with a 1px inset accent ring. 'swatch' (butted colour chips inside one
     *  1px `var(--border)` frame, zero gap): selected is a ring only, no fill. */
    look?: 'bracket' | 'segment' | 'icon' | 'swatch'
}

/**
 * A row of mutually-exclusive buttons: the active one is `selected`, the rest
 * `unselected`. This is THE canonical selected/unselected consumer — graph mode
 * + 2D/3D rows, the calendar view switcher, and BaseView's tabs.
 *
 * `look="bracket"` (the default) renders every option as `kind="text"` — the same `[label]`
 * bracket button as everywhere else in the app, spaced `--sp-4` apart, no box. Every other look
 * (`segment` / `icon` / `swatch`) keeps `kind="segment"` — the OLD `kind="text"` look (uppercase,
 * bordered, butted, sized) — for the drawing toolbar's tool/colour groups.
 */
function SegmentedToggle<T>(props: SegmentedToggleProps<T>) {
    const look = () => props.look ?? 'bracket'
    const boxed = () => look() !== 'bracket'
    return (
        <div
            class={`${styles.segmented} ${props.class ?? ''}`}
            data-look={look()}
            data-segmented=""
        >
            <For each={props.options}>
                {opt => (
                    <Button
                        kind={boxed() ? 'segment' : 'text'}
                        state={
                            opt.id === props.value ? 'selected' : 'unselected'
                        }
                        size={boxed() ? props.size : undefined}
                        aria-pressed={
                            look() === 'bracket'
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
