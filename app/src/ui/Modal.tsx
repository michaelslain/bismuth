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
     * Escape hatch for callers that need the actual panel DOM node (e.g. a focus
     * guard checking `panelEl.contains(target)`). Prefer this over matching
     * `props.class` with `closest()` — that string survives a CSS-module hash as
     * text but stops matching anything once the class becomes a hashed local.
     */
    panelRef?: (el: HTMLDivElement) => void
    children: JSX.Element
}

/**
 * Shared overlay shell: a Portal-mounted backdrop that closes on Escape and
 * (optionally) on backdrop click, with the inner panel stopping propagation.
 * Replaces the hand-rolled `.modal-overlay > panel` + Escape-keydown blocks that
 * EventModal / RecurrenceDialog / CategoryPanel / PaletteModal each reimplemented.
 *
 * The inner panel always carries `.asc-modal` (ui/ui.css: pop-bg-strong fill, blur(6px),
 * hairline border, radius 5, --shadow-modal) — the ONE floating-panel chrome every modal
 * in the app shares. `props.class` still layers on top for call-site sizing/layout, and a
 * caller with its own background/border/radius can win by pairing its selector with
 * `.asc-modal` (higher specificity than a bare app-level class) rather than editing here.
 */
export function Modal(props: ModalProps) {
    const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation()
            props.onClose()
        }
    }
    onMount(() => window.addEventListener('keydown', handleKey))
    onCleanup(() => window.removeEventListener('keydown', handleKey))

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
                    onClick={e => e.stopPropagation()}
                    ref={el => props.panelRef?.(el)}
                >
                    {props.children}
                </div>
            </div>
        </Portal>
    )
}
