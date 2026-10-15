import { For, Show, type JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import { Button, type ButtonSize } from './Button'
import iconSize from './iconSize'
import styles from './SegmentedToggle.module.css'

export type SegmentedOption<T> = {
    id: T
    /** Text (or any node) drawn in the option. Give `label` or `icon`, not both. */
    label?: JSX.Element
    /** Icon name drawn at the app's one icon size, for icon-only groups (`look="icon"`). The
     *  option's accessible name is `ariaLabel`, else `title`, else `id`. */
    icon?: string
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
    /** `look="icon"` only: the off segments draw no bracket space, so the one `[▣]` sits the same
     *  gap from its neighbours as two bare glyphs do (see IconButton's `pickOne`). Leave it off where
     *  a row must keep fixed columns — the drawing dock's stacked colour/size rows line up by column,
     *  and a moving selection would shift one row against the other. */
    pickOne?: boolean
}

/** `size` scales the whole icon cell, glyph and brackets together (one scale per step). md is the
 *  app's one icon size; lg is Button's own 1.25x step (`.btn--icon.btn--lg`), sm its reciprocal. */
const ICON_SCALE = { sm: 0.8, md: 1, lg: 1.25 } as const

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
    const scale = () => ICON_SCALE[props.size ?? 'md']
    // The brackets read --iconbar-glyph as their font-size. lg already multiplies it by 1.25 in
    // Button.module.css, and md is the --icon fallback, so only sm needs the variable set here.
    const rootStyle = () =>
        props.look === 'icon' && props.size === 'sm'
            ? { '--iconbar-glyph': `calc(var(--icon) * ${ICON_SCALE.sm})` }
            : undefined
    return (
        <div
            class={`${styles.segmented} ${props.class ?? ''}`}
            data-look={props.look ?? 'bracket'}
            data-segmented=""
            style={rootStyle()}
        >
            <For each={props.options}>
                {opt => (
                    <Button
                        kind={kind()}
                        state={
                            opt.id === props.value ? 'selected' : 'unselected'
                        }
                        size={props.size}
                        pickOne={props.pickOne}
                        aria-pressed={opt.id === props.value}
                        class={`${props.segmentClass ?? ''} ${opt.class ?? ''}`}
                        title={kind() === 'icon' ? undefined : opt.title}
                        data-tooltip={
                            kind() === 'icon'
                                ? (opt.title ??
                                  opt.ariaLabel ??
                                  String(opt.id))
                                : undefined
                        }
                        aria-label={
                            opt.ariaLabel ??
                            (kind() === 'icon'
                                ? (opt.title ?? String(opt.id))
                                : undefined)
                        }
                        disabled={opt.disabled}
                        onClick={() => props.onChange(opt.id)}
                    >
                        <Show when={opt.icon} fallback={opt.label}>
                            {name => (
                                <Icon
                                    value={name()}
                                    size={iconSize() * scale()}
                                />
                            )}
                        </Show>
                    </Button>
                )}
            </For>
        </div>
    )
}

export default SegmentedToggle
export { SegmentedToggle }
