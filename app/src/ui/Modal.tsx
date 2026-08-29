import { onCleanup, onMount, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import './ui.css'

export type ModalProps = {
    onClose: () => void
    /** Class for the inner panel (e.g. "event-modal", "recurrence-dialog"). */
    class?: string
    /** Close when the backdrop (outside the panel) is clicked. Default true. */
    closeOnBackdrop?: boolean
    /**
     * The dialog's accessible name, announced when focus enters it. A dialog with no name is
     * announced as bare "dialog", which tells a screen-reader user nothing about what just took
     * over their screen — so this is optional only for typecheck compatibility with existing call
     * sites, and DEV warns when it is missing. Pass the same words the panel's own heading uses.
     */
    label?: string
    /**
     * Escape hatch for callers that need the actual panel DOM node (e.g. a focus
     * guard checking `panelEl.contains(target)`). Prefer this over matching
     * `props.class` with `closest()` — that string survives a CSS-module hash as
     * text but stops matching anything once the class becomes a hashed local.
     */
    panelRef?: (el: HTMLDivElement) => void
    children: JSX.Element
}

/** Tag selectors only, never class names: a class-keyed focusable query would be hashed to
 *  nothing by CSS Modules the moment a panel's markup moved into a module (the trap CLAUDE.md
 *  documents for `closest('.some-class')`). `:not([tabindex="-1"])` drops the programmatic-focus
 *  hosts — the panel itself, and things like InkOverlay that hold focus without being a stop. */
const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Shared overlay shell: a Portal-mounted backdrop that closes on Escape and
 * (optionally) on backdrop click, with the inner panel stopping propagation.
 * Replaces the hand-rolled `.modal-overlay > panel` + Escape-keydown blocks that
 * EventModal / RecurrenceDialog / CategoryPanel / PaletteModal each reimplemented.
 *
 * The inner panel always carries `.asc-modal` (ui/ui.css: pop-bg-strong fill, hairline border,
 * radius 0, no blur, no shadow — flattened 2026-08-27, visual-unification audit §9.2/§9.3,
 * wave 1) — the ONE floating-panel chrome every modal in the app shares. `props.class` still
 * layers on top for call-site sizing/layout, and a
 * caller with its own background/border/radius can win by pairing its selector with
 * `.asc-modal` (higher specificity than a bare app-level class) rather than editing here.
 *
 * ── Dialog semantics (added 2026-08-29, design critique P0) ────────────────────────────────
 * This used to be a plain `<div>` pair: no `role`, no `aria-modal`, no initial focus, no trap and
 * no restore. Opening any modal and pressing Tab walked a keyboard user straight THROUGH the
 * scrim into the page behind it, where their focus was then invisible (the ring was globally
 * suppressed — see styles/reset.css). Fixing the ring without fixing this would have produced a
 * visible ring wandering around underneath an open dialog, which is worse than no ring at all.
 *
 * All four pieces are here rather than at the ~20 call sites deliberately: every one of them
 * would otherwise reimplement it, which is exactly how the Escape handling this component already
 * absorbed got duplicated four ways.
 */
function Modal(props: ModalProps) {
    let panelEl: HTMLDivElement | undefined
    // Captured at mount, restored at cleanup: closing a dialog must put focus back where the user
    // opened it from, or every close silently sends them to the top of the document.
    let opener: HTMLElement | null = null

    const focusables = () =>
        panelEl
            ? ([...panelEl.querySelectorAll(FOCUSABLE)] as HTMLElement[]).filter(
                  el => el.offsetParent !== null || el === document.activeElement,
              )
            : []

    const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation()
            props.onClose()
            return
        }
        if (e.key !== 'Tab' || !panelEl) return
        const items = focusables()
        // No stops inside the panel: keep focus on the panel itself rather than letting Tab escape
        // to the page behind the scrim.
        if (!items.length) {
            e.preventDefault()
            panelEl.focus()
            return
        }
        const first = items[0]!
        const last = items[items.length - 1]!
        const active = document.activeElement as HTMLElement | null
        // Wrap at both ends, and pull focus back in if it has escaped the panel entirely (a
        // backdrop click, or a caller that moved focus itself).
        if (!panelEl.contains(active)) {
            e.preventDefault()
            ;(e.shiftKey ? last : first).focus()
        } else if (e.shiftKey && active === first) {
            e.preventDefault()
            last.focus()
        } else if (!e.shiftKey && active === last) {
            e.preventDefault()
            first.focus()
        }
    }

    onMount(() => {
        opener = document.activeElement as HTMLElement | null
        window.addEventListener('keydown', handleKey)
        // Focus the first real control if there is one, else the panel. Deferred a frame because a
        // caller's children may still be mounting on the same tick.
        queueMicrotask(() => {
            const items = focusables()
            ;(items[0] ?? panelEl)?.focus()
        })
        if (import.meta.env?.DEV && !props.label)
            console.warn(
                'Modal: no `label` — screen readers will announce this as an unnamed "dialog". Pass the same words as the panel heading.',
            )
    })
    onCleanup(() => {
        window.removeEventListener('keydown', handleKey)
        // Only restore if the opener is still in the document; a modal that deleted the thing it
        // was opened from would otherwise throw focus into a detached node.
        if (opener?.isConnected) opener.focus()
    })

    return (
        <Portal>
            <div
                class="ui-overlay"
                onClick={() => {
                    if (props.closeOnBackdrop !== false) props.onClose()
                }}
            >
                <div
                    class={'asc-modal' + (props.class ? ` ${props.class}` : '')}
                    role="dialog"
                    aria-modal="true"
                    aria-label={props.label}
                    // -1: the panel is a focus TARGET (the fallback when it holds no controls, and
                    // the anchor a screen reader announces on open) but never a Tab stop of its own.
                    tabindex="-1"
                    onClick={e => e.stopPropagation()}
                    ref={el => {
                        panelEl = el
                        props.panelRef?.(el)
                    }}
                >
                    {props.children}
                </div>
            </div>
        </Portal>
    )
}

export default Modal
export { Modal }
