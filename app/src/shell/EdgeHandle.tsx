// app/src/shell/EdgeHandle.tsx
// The grab strip on a panel's edge line — the left sidebar's right edge and the tab rail's left
// edge. One gesture surface, three ways in:
//   • DRAG it to resize the panel (a pointer that travels more than DRAG_SLOP px is a drag);
//   • CLICK it to run the panel's toggle (hide/show the sidebar, pin/unpin the rail) — the same
//     command as its keybinding, so the line and Alt+S / Alt+Shift+S are one action;
//   • HOVER it (or focus it) and a chevron button springs out at the line's vertical centre,
//     pointing the way the panel will move — the same toggle, as a visible target. Its tooltip
//     names the action and the live keybinding.
//
// The component owns no width. It reports a drag as a running `dx` from where the pointer went
// down, and the caller turns that into a clamped width — which side grows is the caller's business
// (the sidebar grows with +dx, the rail with -dx). Where the strip SITS is the caller's too, via a
// positioned slot: the sidebar's strip lives in EditorPane at its left edge, the rail's in TabRail.
//
// The button claims its own pointer events (`gestureStops`) so pressing it is not also the strip's
// press — otherwise one click would toggle twice.
import styles from './EdgeHandle.module.css'
import IconButton from '../ui/IconButton'
import { gestureStops } from '../ui/stopGestures'
import { parseCombo } from '../ui/ascii/parseCombo'
import { isActivateKey } from '../ui/widgetKeys'
import { createSignal } from 'solid-js'

/** Pixels a pressed pointer may wander before the press counts as a drag rather than a click. */
const DRAG_SLOP = 3

export type EdgeHandleProps = {
    /** Which side of the line the button opens on — always away from the panel, over the editor. */
    buttonSide: 'left' | 'right'
    /** Accessible name of the strip, e.g. "sidebar edge". */
    label: string
    /** What the toggle does, lowercase — `hide sidebar`, `pin tab rail`. The button's name. */
    action: string
    /** Which way the chevron points: the direction the panel's edge will move on toggle. */
    direction: 'left' | 'right'
    /** The toggle's keybinding in the app's combo syntax, appended to the button's tooltip. */
    combo?: string
    /** False while the panel is collapsed to nothing — the strip still toggles but cannot drag. */
    resizable?: boolean
    /** The panel is FULLY hidden, so this strip is all that is left of it at the window's edge:
     *  widen the hover zone so reaching toward that side of the screen reveals the button, rather
     *  than demanding the pointer land on a 6px sliver. Only the sidebar ever hides fully (either side) —
     *  the tab rail always keeps its 46px column, so its line stays a thin strip. */
    reveal?: boolean
    onResizeStart?: () => void
    /** Running offset from the press point, in px (+ = rightward). */
    onResize?: (dx: number) => void
    onResizeEnd?: () => void
    /** The click: run the panel's toggle. */
    onActivate: () => void
    className?: string
}

/** "Alt+Shift+S" → "⌥⇧S" on a Mac — the first alternative only, one run, for a tooltip. */
function comboText(combo: string | undefined): string {
    const first = parseCombo(combo)[0]
    return first ? first.join('') : ''
}

function EdgeHandle(props: EdgeHandleProps) {
    const [dragging, setDragging] = createSignal(false)
    let startX = 0
    let pressed = false
    let rootEl: HTMLDivElement | undefined

    const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        e.preventDefault() // no text selection riding along with the drag
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        startX = e.clientX
        pressed = true
    }
    const onPointerMove = (e: PointerEvent) => {
        if (!pressed) return
        const dx = e.clientX - startX
        if (!dragging()) {
            if (props.resizable === false || Math.abs(dx) <= DRAG_SLOP) return
            setDragging(true)
            props.onResizeStart?.()
        }
        props.onResize?.(dx)
    }
    const finish = (e: PointerEvent, cancelled: boolean) => {
        if (!pressed) return
        pressed = false
        const el = e.currentTarget as HTMLElement
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        if (dragging()) {
            setDragging(false)
            props.onResizeEnd?.()
        } else if (!cancelled) {
            // A strip focused earlier (Tab, or a story's play) would otherwise keep the rail open
            // through `:focus-within` after a pointer click — the pointer is now the input.
            el.blur()
            props.onActivate()
        }
    }
    // Keyboard: a focused strip (Tab reaches it) runs its toggle on the activate key — the same
    // Enter/Space every button-like widget reads (ui/widgetKeys.ts). Resizing is pointer-only.
    const onKeyDown = (e: KeyboardEvent) => {
        if (!isActivateKey(e)) return
        e.preventDefault()
        props.onActivate()
    }
    const tooltip = () => {
        const keys = comboText(props.combo)
        return keys ? `${props.action} (${keys})` : props.action
    }

    return (
        <div
            ref={rootEl}
            class={`${styles['edge']} ${props.className ?? ''}`}
            classList={{
                [styles['button-left']]: props.buttonSide === 'left',
                [styles['fixed']]: props.resizable === false,
                [styles['reveal']]: !!props.reveal,
            }}
            role="separator"
            aria-orientation="vertical"
            aria-label={props.label}
            tabIndex={0}
            data-edge-handle
            data-dragging={dragging() ? 'true' : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={e => finish(e, false)}
            onPointerCancel={e => finish(e, true)}
            // A click must not FOCUS the strip: the rail's `:focus-within` would then hold it open
            // after a click that just unpinned it. Keyboard focus (Tab) still reaches it.
            onMouseDown={e => e.preventDefault()}
            onKeyDown={onKeyDown}
        >
            <div class={styles['line']} />
            <div
                class={styles['pop']}
                data-edge-button
                {...gestureStops}
                // Not focused by a click either: focus left on this button would hold the rail
                // open through `:focus-within` after the click that just unpinned it.
                onMouseDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                }}
            >
                <div class={styles['chip']}>
                    <IconButton
                        icon={props.direction === 'left' ? 'ChevronLeft' : 'ChevronRight'}
                        label={tooltip()}
                        tabIndex={-1}
                        onClick={() => {
                            rootEl?.blur()
                            props.onActivate()
                        }}
                    />
                </div>
            </div>
        </div>
    )
}

export default EdgeHandle
