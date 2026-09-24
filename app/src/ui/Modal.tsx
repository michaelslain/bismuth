import { onCleanup, onMount, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './Modal.module.css'
import { isDismissKey } from './widgetKeys'

export type ModalProps = {
    onClose: () => void
    /** Class for the inner panel (e.g. "event-modal", "recurrence-dialog"). */
    class?: string
    /** A second class on the same panel element, for a caller that composes its own panel-chrome
     *  class (sizing/layout) separately from `class` (e.g. FormModal's `.panel`). Kept distinct
     *  from `class` only so a caller layering both a wrapper's `class` and its own chrome class
     *  doesn't have to pre-join them itself. */
    panelClass?: string
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

/** How long after mount a late-mounting body control may still take initial focus (see onMount).
 *  Long enough for a fetch-gated body over the local core; short enough that nothing reaches for
 *  focus once the dialog has visibly settled. */
const LATE_MOUNT_MS = 2000

/**
 * Shared overlay shell: a Portal-mounted backdrop that closes on the dismiss key
 * (settings.keybindings['ui-dismiss'], Escape by default — see ui/widgetKeys.ts's
 * isDismissKey) and (optionally) on backdrop click, with the inner panel stopping
 * propagation. Replaces the hand-rolled `.modal-overlay > panel` + Escape-keydown
 * blocks that EventModal / RecurrenceDialog / CategoryPanel / PaletteModal each
 * reimplemented.
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
            ? (
                  [...panelEl.querySelectorAll(FOCUSABLE)] as HTMLElement[]
              ).filter(
                  el =>
                      el.offsetParent !== null || el === document.activeElement,
              )
            : []

    const handleKey = (e: KeyboardEvent) => {
        if (isDismissKey(e)) {
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

    // Tears down the late-mount watch below; replaced once the watch starts, and always safe to
    // call (cleanup calls it whether or not the watch ever started).
    let stopWatching = () => {}
    // A modal can unmount before its own initial-focus microtask runs; that microtask must then
    // neither focus a detached node nor start a watch nothing will ever stop.
    let disposed = false

    onMount(() => {
        opener = document.activeElement as HTMLElement | null
        window.addEventListener('keydown', handleKey)
        // Initial focus: the first focusable inside the body (`[data-modal-body]`), in DOM order,
        // else the first non-close focusable in the panel (a footer action — e.g. daemon setup,
        // which has no body control), else the close button (the last resort for a modal with
        // nothing else at all), then the panel. DOM order beats "any form control" — a dialog
        // whose only input sits near the BOTTOM (QueryBuilder's `limit` field) must still land on
        // its first body control, not scroll straight to that input.
        //
        // A caller's body can mount AFTER this component does — QueryBuilder's sections sit behind
        // `createResource` + `<Show>`, GcalConnectModal's input mounts a tick late — so the first
        // pick can see only the header's `[x]` or a footer action. A fixed re-check (this used to
        // be a second pick after two requestAnimationFrames) only covers a body that happens to
        // land inside that window; anything gated on a fetch lands later and focus stayed on `[x]`.
        //
        // So after the first pick, a MutationObserver on the panel re-picks whenever the panel's
        // DOM changes, for as long as focus is still exactly where THIS component last put it. It
        // is bounded: it stops at the first user keydown/pointerdown, the moment focus moves
        // anywhere this component did not put it (the user, or a component moving focus itself),
        // once focus sits inside the body (nothing better can appear), after LATE_MOUNT_MS, and on
        // cleanup. So it can only ever move focus nobody else has touched.
        const pick = () => {
            const items = focusables()
            const body = panelEl?.querySelector('[data-modal-body]')
            const bodyFirst = body
                ? items.find(
                      el =>
                          body.contains(el) &&
                          !el.matches('[data-modal-close]'),
                  )
                : undefined
            const firstNonClose = items.find(
                el => !el.matches('[data-modal-close]'),
            )
            return bodyFirst ?? firstNonClose ?? items[0] ?? panelEl
        }
        let placed: HTMLElement | undefined
        const place = () => {
            const next = pick()
            if (next && next !== placed) {
                placed = next
                next.focus()
            }
            const body = panelEl?.querySelector('[data-modal-body]')
            return !!(placed && body && body.contains(placed))
        }
        queueMicrotask(() => {
            if (disposed || !panelEl) return
            const active = document.activeElement as HTMLElement | null
            // A component already placed focus inside the panel from its OWN render-time
            // microtask, queued before this one — e.g. CardEditModal focusing a specific
            // property field via its `focusTarget` prop. Leave it alone: no pick, and no watch
            // to second-guess a placement this component didn't make.
            if (active && active !== panelEl && panelEl.contains(active))
                return
            if (place()) return
            const panel = panelEl
            const observer = new MutationObserver(() => {
                const active = document.activeElement
                // Focus still ours — or dropped to <body> because the node we focused was
                // unmounted, which no user action produces without a pointerdown/keydown first.
                if (active !== placed && active !== document.body && active)
                    return stopWatching()
                if (place()) stopWatching()
            })
            // Focus leaving what we placed, for any reason, ends the watch for good.
            const onFocusIn = (e: FocusEvent) => {
                if (e.target !== placed) stopWatching()
            }
            const timer = setTimeout(() => stopWatching(), LATE_MOUNT_MS)
            stopWatching = () => {
                observer.disconnect()
                clearTimeout(timer)
                document.removeEventListener('focusin', onFocusIn, true)
                window.removeEventListener('keydown', stopWatching, true)
                window.removeEventListener('pointerdown', stopWatching, true)
                stopWatching = () => {}
            }
            observer.observe(panel, {
                childList: true,
                subtree: true,
                // A control can become focusable without being inserted: enabled, or un-hidden
                // by a class/style change (focusables() skips anything with no layout box).
                attributes: true,
                attributeFilter: ['disabled', 'hidden', 'class', 'style'],
            })
            document.addEventListener('focusin', onFocusIn, true)
            window.addEventListener('keydown', stopWatching, true)
            window.addEventListener('pointerdown', stopWatching, true)
        })
        if (import.meta.env?.DEV && !props.label)
            console.warn(
                'Modal: no `label` — screen readers will announce this as an unnamed "dialog". Pass the same words as the panel heading.',
            )
    })
    onCleanup(() => {
        disposed = true
        stopWatching()
        window.removeEventListener('keydown', handleKey)
        // Only restore if the opener is still in the document; a modal that deleted the thing it
        // was opened from would otherwise throw focus into a detached node.
        if (opener?.isConnected) opener.focus()
    })

    return (
        <Portal>
            <div
                class={styles['ui-overlay']}
                onClick={() => {
                    if (props.closeOnBackdrop !== false) props.onClose()
                }}
            >
                <div
                    class={[
                        styles['asc-modal'],
                        props.class,
                        props.panelClass,
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    data-modal-panel=""
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
