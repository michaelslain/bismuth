// app/src/ui/TooltipHost.tsx
// THE hover-name bubble. Mounted ONCE per document (App.tsx; the Storybook decorator). It reads
// `data-tooltip="<text>"` from whatever is under the pointer, or holds keyboard focus-visible,
// and shows that text in a small label under the element (above it when there is no room). A holder
// may also carry `data-tooltip-keybinding="<catalog id>"`: the bubble then adds that binding's live
// combo (settings.keybindings, read on every open) as a muted Kbd beside the name.
//
// Hover is found by hit-testing the pointer position on document-level pointermove, never by an
// event targeted at the element itself: a DISABLED button gets no pointer events in some engines
// (WKWebView), and an `elementFromPoint` hit-test sees it all the same.
import { createSignal, onCleanup, onMount, Show, createEffect, type Component } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './TooltipHost.module.css'
import { placeTooltip } from './tooltipPlacement'
import { isDismissKey } from './widgetKeys'
import Kbd from './ascii/Kbd'
import { tooltipContent, type TooltipContent } from './tooltipContent'
import { settings } from '../settings'

export type TooltipHostProps = {
    /** Extra class merged onto the bubble. */
    class?: string
}

/** Resolve a CSS length / time token to a number through a probe, so the host reads the real
 *  token (theme- and motion-scale-aware) instead of re-declaring a value. */
function probe(prop: 'width' | 'transitionDuration', value: string): string {
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.visibility = 'hidden'
    el.style[prop] = value
    document.body.appendChild(el)
    const out = getComputedStyle(el)[prop]
    el.remove()
    return out
}

/** `--dur-tooltip` in ms (computed `0.4s` / `400ms`). */
function delayMs(): number {
    const raw = probe('transitionDuration', 'var(--dur-tooltip)')
    const n = parseFloat(raw)
    if (Number.isNaN(n)) return 0
    return raw.endsWith('ms') ? n : n * 1000
}

/** `--sp-2` in px. */
function gapPx(): number {
    const n = parseFloat(probe('width', 'var(--sp-2)'))
    return Number.isNaN(n) ? 4 : n
}

const holderOf = (el: Element | null): HTMLElement | null =>
    (el?.closest('[data-tooltip], [data-tooltip-keybinding]') as HTMLElement | null) ?? null

/** What a holder shows right now: its `data-tooltip` name plus the live combo of its
 *  `data-tooltip-keybinding` id, read from `settings.keybindings` each time (a rebind shows on the
 *  next open). Null when it has neither a name nor a bound combo. */
const contentOf = (el: HTMLElement): TooltipContent | null =>
    tooltipContent(
        el.getAttribute('data-tooltip'),
        el.getAttribute('data-tooltip-keybinding'),
        settings.keybindings,
    )

const TooltipHost: Component<TooltipHostProps> = props => {
    const [holder, setHolder] = createSignal<HTMLElement | null>(null)
    const [content, setContent] = createSignal<TooltipContent | null>(null)
    const [bubble, setBubble] = createSignal<HTMLDivElement>()
    let timer: ReturnType<typeof setTimeout> | undefined
    /** Pending / shown holder, so repeat moves over the same button do nothing. */
    let current: HTMLElement | null = null
    /** A holder dismissed by click or Escape stays quiet until the pointer reaches another. */
    let quiet: HTMLElement | null = null
    let source: 'pointer' | 'focus' = 'pointer'

    const hide = () => {
        clearTimeout(timer)
        timer = undefined
        current = null
        setHolder(null)
    }

    const open = (el: HTMLElement) => {
        setContent(contentOf(el))
        setHolder(el)
    }

    const request = (el: HTMLElement, immediate: boolean) => {
        if (el === current) return
        current = el
        clearTimeout(timer)
        if (immediate || holder()) {
            open(el) // moving straight onto another tooltip'd button swaps with no new delay
            return
        }
        timer = setTimeout(() => open(el), delayMs())
    }

    /** A holder removed from the DOM fires no focusout; drop its bubble on the next event. */
    const dropStale = () => {
        const h = holder()
        if (h && !h.isConnected) hide()
    }

    const onMove = (e: PointerEvent) => {
        dropStale()
        if (e.pointerType === 'touch') return
        const el = holderOf(document.elementFromPoint(e.clientX, e.clientY))
        if (!el || !contentOf(el)) {
            quiet = null
            if (source === 'pointer') hide()
            return
        }
        if (el === quiet) return
        quiet = null
        source = 'pointer'
        request(el, false)
    }

    const dismiss = () => {
        quiet = current
        hide()
    }

    const onFocusIn = (e: FocusEvent) => {
        dropStale()
        const el = holderOf(e.target as Element)
        if (!el || !contentOf(el)) {
            if (source === 'focus') hide()
            return
        }
        if (!(e.target as Element).matches(':focus-visible')) {
            if (source === 'focus') hide()
            return
        }
        source = 'focus'
        request(el, true)
    }

    const onFocusOut = () => {
        if (source === 'focus') hide()
    }

    const onKey = (e: KeyboardEvent) => {
        dropStale()
        if (isDismissKey(e)) dismiss()
    }

    const onLeaveWindow = (e: PointerEvent) => {
        if (!e.relatedTarget && source === 'pointer') hide()
    }

    onMount(() => {
        const opts = { capture: true, passive: true } as const
        document.addEventListener('pointermove', onMove, opts)
        document.addEventListener('pointerdown', dismiss, opts)
        document.addEventListener('pointerout', onLeaveWindow, opts)
        document.addEventListener('scroll', hide, opts)
        document.addEventListener('wheel', hide, opts)
        document.addEventListener('focusin', onFocusIn, opts)
        document.addEventListener('focusout', onFocusOut, opts)
        document.addEventListener('keydown', onKey, opts)
        window.addEventListener('blur', hide)
        onCleanup(() => {
            document.removeEventListener('pointermove', onMove, opts)
            document.removeEventListener('pointerdown', dismiss, opts)
            document.removeEventListener('pointerout', onLeaveWindow, opts)
            document.removeEventListener('scroll', hide, opts)
            document.removeEventListener('wheel', hide, opts)
            document.removeEventListener('focusin', onFocusIn, opts)
            document.removeEventListener('focusout', onFocusOut, opts)
            document.removeEventListener('keydown', onKey, opts)
            window.removeEventListener('blur', hide)
            clearTimeout(timer)
        })
    })

    // Measure and place after the text is in the DOM; the bubble stays hidden until placed.
    createEffect(() => {
        const el = holder()
        const node = bubble()
        content()
        if (!el || !node) return
        const r = el.getBoundingClientRect()
        const placed = placeTooltip({
            anchor: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
            size: { w: node.offsetWidth, h: node.offsetHeight },
            viewport: { w: window.innerWidth, h: window.innerHeight },
            gap: gapPx(),
        })
        node.style.top = `${placed.top}px`
        node.style.left = `${placed.left}px`
        node.style.visibility = 'visible'
        node.setAttribute('data-side', placed.side)
    })

    return (
        <Show when={holder()}>
            <Portal>
                <div
                    ref={setBubble}
                    class={props.class ? `${styles.bubble} ${props.class}` : styles.bubble}
                    classList={{ [styles.withKey]: !!content()?.combo && !!content()?.label }}
                    data-tooltip-bubble=""
                    aria-hidden="true"
                >
                    {content()?.label}
                    <Show when={content()?.combo}>
                        <Kbd combo={content()!.combo} muted />
                    </Show>
                </div>
            </Portal>
        </Show>
    )
}

export default TooltipHost
