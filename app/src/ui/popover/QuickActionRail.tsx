// app/src/ui/popover/QuickActionRail.tsx
// A small icon strip hung off a context menu's LEFT edge, for actions that must stay visible
// instead of competing with a long option list (the emoji library, #67). Composes <Popover> (tone
// "menu") for the box — it used to hand-build the same recipe with a `.bismuth-popover` class and a
// mirrored `RAIL_WIDTH = 40` constant, which only worked while IconButton stayed 30px wide.
//
// It MEASURES itself instead: its right edge is the menu's left edge (`x`), so it is placed by
// `x - gap - measuredWidth` with no constant to keep in sync. The one case that needs the width up
// front — no room on the left, so it flips to hang off the menu's right edge — reads the same
// measurement, which is taken on mount, before the first paint. Vertically it flips like the menu
// (placeBelowOrAbove) off ITS OWN measured height: one column of buttons is not a twelve-row list.
import { createEffect, createSignal, For, type Component } from 'solid-js'
import Popover from '../Popover'
import { IconButton } from '../IconButton'
import { placeBelowOrAbove } from './placeAnchored'
import styles from './QuickActionRail.module.css'

/** A top-level action shown as an icon on the rail. `label` is the tooltip/aria-label; it isn't
 *  drawn. */
export type QuickAction = { icon: string; label: string; onSelect: () => void }

export type QuickActionRailProps = {
    actions: QuickAction[]
    /** The menu's left edge (the rail's right edge hangs off it). */
    x: number
    /** The menu's natural top. */
    y: number
    /** The anchor's top edge, when the menu is anchored to an element rather than a point. */
    flipFrom?: number
    /** The menu's measured width — read ONLY to hang the rail off the menu's right edge when there
     *  is no room on its left. */
    menuWidth: number
    /** Called after an action ran, so the menu can close. */
    onPick: () => void
    class?: string
}

const GAP = 6

const QuickActionRail: Component<QuickActionRailProps> = props => {
    let el: HTMLDivElement | undefined
    const [size, setSize] = createSignal({ w: 0, h: 0 })
    createEffect(() => {
        props.actions // track: re-measure when the rail's own buttons change
        const r = el?.getBoundingClientRect()
        setSize({ w: r?.width ?? 0, h: r?.height ?? 0 })
    })
    // Derived, not a one-shot signal: a second right-click reuses this component and only updates
    // props, so a snapshot taken at creation would strand the rail at the first menu's position.
    const left = () => {
        const l = props.x - GAP - size().w
        return l >= GAP ? l : props.x + props.menuWidth + GAP
    }
    const top = () =>
        placeBelowOrAbove({
            y: props.y,
            h: size().h,
            viewportH: window.innerHeight,
            flipFrom: props.flipFrom,
            gap: 4,
        })
    return (
        <Popover
            tone="menu"
            ref={e => (el = e)}
            class={`${styles.rail} ${props.class ?? ''}`}
            style={{
                position: 'fixed',
                top: `${top()}px`,
                left: `${left()}px`,
            }}
            onClick={e => e.stopPropagation()}
        >
            <For each={props.actions}>
                {a => (
                    <IconButton
                        icon={a.icon}
                        label={a.label}
                        onClick={() => {
                            a.onSelect()
                            props.onPick()
                        }}
                    />
                )}
            </For>
        </Popover>
    )
}

export default QuickActionRail
