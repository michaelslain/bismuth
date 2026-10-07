// app/src/ui/AnchoredPopover.tsx
// The anchor + dismiss layer Select and DateFieldEditor each hand-rolled: a portaled,
// fixed-positioned surface under a trigger element, repositioned on scroll/resize while open,
// dismissed on Escape or an outside pointerdown. Owns only positioning + the backdrop/panel
// stacking pair (1090/1100) — the CONTENT (a list, a date picker) is the caller's, passed as
// children, so this stays a pure anchoring primitive rather than another popover surface.
//
// FIRST FRAME: the panel is measured the moment it MOUNTS (a ref callback + a microtask — the
// element is attached to the portal by then, and the microtask runs before the browser paints),
// so the first painted frame is already beside the anchor. It used to start at 0,0 and rely on an
// open effect that ran BEFORE the panel existed, so `reposition()` bailed out and the panel
// painted in the page's top-left corner, far from its anchor. (Not hidden while unmeasured: a
// `visibility: hidden` panel cannot take focus, and a child may focus itself on mount.)
import {
    children as resolveChildren,
    createEffect,
    createSignal,
    onCleanup,
    Show,
    type Component,
    type JSX,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { computeAnchorRect } from './anchorPosition'
import { isDismissKey } from './widgetKeys'
import styles from './AnchoredPopover.module.css'

export type AnchoredPopoverProps = {
    /** The element to anchor under (or above) — a getter so the caller can hand back
     *  `undefined` before its trigger ref is mounted. */
    anchor: () => HTMLElement | undefined
    /** The trigger itself, when `anchor` is a larger element (a whole header). A press inside
     *  its rect is the trigger's own press — the backdrop covers it, so the test is geometric. */
    toggleEl?: () => HTMLElement | undefined
    /** Fired instead of `onDismiss` when the press lands on the trigger, so a caller can close
     *  without treating it as a cancel. */
    onAnchorPress?: () => void
    open: boolean
    /** Fired on Escape or an outside pointerdown — never on a click inside the panel. */
    onDismiss: () => void
    children: JSX.Element
    /** Merged onto the panel (root positioned element), alongside the module's own class. */
    class?: string
    placement?: 'below' | 'above'
    /** Extra class merged onto the backdrop, alongside the module's own class — Select's
     *  `.ui-select-backdrop` carries no styling of its own anymore, but bases/PropertyValueEditor.tsx
     *  still needs a stable element to attribute-select (see `backdropAttrs`). */
    backdropClass?: string
    /** Extra attributes (typically a `data-*` runtime hook) merged onto the backdrop — e.g.
     *  Select's `data-select-backdrop`, read by bases/PropertyValueEditor.tsx's outside-click
     *  guard. Kept generic rather than baking a caller's hook into this primitive. */
    backdropAttrs?: Record<string, string | boolean>
    /** Extra attributes merged onto the panel — e.g. DateFieldEditor's `data-testid` for its
     *  story/tests. */
    panelAttrs?: Record<string, string | boolean>
}

const AnchoredPopover: Component<AnchoredPopoverProps> = props => {
    // `undefined` until the mounted panel has been measured (the next microtask after mount).
    const [pos, setPos] = createSignal<{ top: number; left: number } | undefined>()
    let panelEl: HTMLDivElement | undefined

    function reposition(): void {
        const anchorEl = props.anchor()
        if (!props.open || !anchorEl || !panelEl?.isConnected) return
        const panelRect = panelEl.getBoundingClientRect()
        const { top, left } = computeAnchorRect(
            anchorEl.getBoundingClientRect(),
            { width: panelRect.width, height: panelRect.height },
            { width: window.innerWidth, height: window.innerHeight },
            props.placement ?? 'below',
        )
        setPos({ top, left })
    }

    // `children` resolves the JSX once into a stable getter — reading `props.children` directly
    // in the effect would construct a fresh subtree (a second, unmounted PopoverList/DatePicker)
    // on every read since JSX children are a getter in Solid.
    const resolved = resolveChildren(() => props.children)

    // Re-measure + reposition whenever the popover opens, or its content changes shape while
    // open (resolved is reactive — a different option set is a different height).
    createEffect(() => {
        resolved() // track: re-measure when the content changes
        if (props.open) reposition()
        else setPos(undefined) // a reopen must not flash the previous open's position
    })

    // The panel does not exist when the effect above first runs on open, so the effect cannot
    // place it. Measure once the element is actually mounted: the microtask runs after the
    // portal has attached it and before the next paint (a timeout would race under load).
    function onPanelMount(el: HTMLDivElement): void {
        panelEl = el
        queueMicrotask(reposition)
    }

    function onWindowPointerDown(e: PointerEvent): void {
        if (!props.open) return
        const target = e.target as Node | null
        if (panelEl && target && panelEl.contains(target)) return
        // The backdrop sits over the trigger, so `e.target` is never the trigger: test the press
        // point against the trigger's rect instead.
        const r = (props.toggleEl ?? props.anchor)?.()?.getBoundingClientRect()
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            if (props.onAnchorPress) props.onAnchorPress()
            else props.onDismiss()
            return
        }
        props.onDismiss()
    }
    // Capture phase: runs before any bubble-phase window listener (a host Modal's) whatever the
    // mount order, so `preventDefault()` reliably tells them the dismiss key was consumed here.
    // Because this runs first, a trigger that also handles Escape while open (Select's) finds
    // the popover already closed by the time its own handler runs, so it never double-fires.
    function onWindowKeyDown(e: KeyboardEvent): void {
        if (!props.open) return
        if (!isDismissKey(e)) return
        e.preventDefault()
        props.onDismiss()
    }

    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('pointerdown', onWindowPointerDown, true)
    window.addEventListener('keydown', onWindowKeyDown, true)
    onCleanup(() => {
        window.removeEventListener('resize', reposition)
        window.removeEventListener('scroll', reposition, true)
        window.removeEventListener('pointerdown', onWindowPointerDown, true)
        window.removeEventListener('keydown', onWindowKeyDown, true)
    })

    return (
        <Show when={props.open}>
            <Portal>
                <div
                    class={`${styles.backdrop}${props.backdropClass ? ` ${props.backdropClass}` : ''}`}
                    {...(props.backdropAttrs ?? {})}
                />
                <div
                    ref={onPanelMount}
                    class={`${styles.panel}${props.class ? ` ${props.class}` : ''}`}
                    style={{
                        top: `${pos()?.top ?? 0}px`,
                        left: `${pos()?.left ?? 0}px`,
                    }}
                    {...(props.panelAttrs ?? {})}
                >
                    {resolved()}
                </div>
            </Portal>
        </Show>
    )
}

export default AnchoredPopover
