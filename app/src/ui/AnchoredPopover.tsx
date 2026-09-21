// app/src/ui/AnchoredPopover.tsx
// The anchor + dismiss layer Select and DateFieldEditor each hand-rolled: a portaled,
// fixed-positioned surface under a trigger element, repositioned on scroll/resize while open,
// dismissed on Escape or an outside pointerdown. Owns only positioning + the backdrop/panel
// stacking pair (1090/1100) — the CONTENT (a list, a date picker) is the caller's, passed as
// children, so this stays a pure anchoring primitive rather than another popover surface.
import { createEffect, createSignal, onCleanup, Show, type Component, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { computeAnchorRect } from './anchorPosition'
import { isDismissKey } from './widgetKeys'
import styles from './AnchoredPopover.module.css'

export type AnchoredPopoverProps = {
    /** The element to anchor under (or above) — a getter so the caller can hand back
     *  `undefined` before its trigger ref is mounted. */
    anchor: () => HTMLElement | undefined
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
    const [pos, setPos] = createSignal<{ top: number; left: number }>({ top: 0, left: 0 })
    let panelEl: HTMLDivElement | undefined

    function reposition(): void {
        const anchorEl = props.anchor()
        if (!anchorEl || !panelEl) return
        const panelRect = panelEl.getBoundingClientRect()
        const { top, left } = computeAnchorRect(
            anchorEl.getBoundingClientRect(),
            { width: panelRect.width, height: panelRect.height },
            { width: window.innerWidth, height: window.innerHeight },
            props.placement ?? 'below',
        )
        setPos({ top, left })
    }

    // Re-measure + reposition whenever the popover opens, or its content changes shape while
    // open (children is reactive — a different option set is a different height).
    createEffect(() => {
        props.children // track: re-measure when the content changes
        if (props.open) reposition()
    })

    function onWindowPointerDown(e: PointerEvent): void {
        if (!props.open) return
        const target = e.target as Node | null
        if (panelEl && target && panelEl.contains(target)) return
        props.onDismiss()
    }
    // Bubble phase, not capture: a caller that already owns its own Escape handling (Select's
    // trigger stops propagation on its keydown when open, routing Escape through its keyboard
    // nav instead) still wins, since stopPropagation there keeps the event from ever reaching
    // window. A caller with no such handling (DateFieldEditor — focus stays on its trigger
    // button, never moving into the portaled panel) gets Escape-to-dismiss for free.
    function onWindowKeyDown(e: KeyboardEvent): void {
        if (!props.open) return
        if (isDismissKey(e)) props.onDismiss()
    }

    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('pointerdown', onWindowPointerDown, true)
    window.addEventListener('keydown', onWindowKeyDown)
    onCleanup(() => {
        window.removeEventListener('resize', reposition)
        window.removeEventListener('scroll', reposition, true)
        window.removeEventListener('pointerdown', onWindowPointerDown, true)
        window.removeEventListener('keydown', onWindowKeyDown)
    })

    return (
        <Show when={props.open}>
            <Portal>
                <div
                    class={`${styles.backdrop}${props.backdropClass ? ` ${props.backdropClass}` : ''}`}
                    {...(props.backdropAttrs ?? {})}
                />
                <div
                    ref={panelEl}
                    class={`${styles.panel}${props.class ? ` ${props.class}` : ''}`}
                    style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
                    {...(props.panelAttrs ?? {})}
                >
                    {props.children}
                </div>
            </Portal>
        </Show>
    )
}

export default AnchoredPopover
