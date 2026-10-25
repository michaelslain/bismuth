// app/src/ui/ViewBar.tsx
// The canonical view header used across content views (graph, bases, calendar,
// flashcards, …): a leading group (identity · locus · facet) and a trailing group
// (readouts · config · actions), composed through NAMED SLOTS rather than positional
// children. Replaces per-view bespoke `.viewbar` markup so every header is
// structurally identical.
import { children, createEffect, createSignal, type JSX, on, onCleanup, onMount, Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import Band from './Band'
import leadOverflow from './leadOverflow'
import { usePaneChrome } from './paneChrome'
import BarOverflow, { type BarOverflowItem } from './BarOverflow'
import { BAR_DROP_LEVELS, dropsToFit, type BarDropLevel } from './barFit'
import styles from './ViewBar.module.css'
import CloseButton from './CloseButton'

/** Appends an optional extra class to a base (hashed) one — used throughout for the `class`/
 *  `parts` merge pattern every region and primitive here takes. */
const cx = (base: string, extra?: string): string =>
    extra ? `${base} ${extra}` : base

const levelOf = (el: HTMLElement): BarDropLevel | undefined => {
    const n = Number(el.getAttribute('data-bar-drop'))
    return (BAR_DROP_LEVELS as readonly number[]).includes(n) ? (n as BarDropLevel) : undefined
}

/** The panel row label for a dropped element: `data-bar-menu-label`, else its first control's
 *  `aria-label` (never `title`), lowercased. Empty means no panel row. */
const menuLabel = (el: HTMLElement): string => {
    const named = el.getAttribute('data-bar-menu-label')
    if (named) return named
    const src =
        el.getAttribute('aria-label') ??
        el.querySelector('[aria-label]')?.getAttribute('aria-label') ??
        ''
    return src.toLowerCase()
}

/** A trail region is hidden with its elements when nothing visible is left in it. A region holding
 *  text, or no element at all, is never hidden. */
const regionEmpty = (region: HTMLElement): boolean => {
    const kids = [...region.childNodes].filter(
        n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent?.trim()),
    )
    return (
        kids.length > 0 &&
        kids.every(k => k.nodeType === 1 && (k as HTMLElement).hasAttribute('data-bar-hidden'))
    )
}

/** The six regions a view bar has. A control's region is decided by the QUESTION it answers, not
 *  by its shape:
 *    identity — what am I looking at?            (no interaction, at most one, leading)
 *    locus    — where am I inside it, and how do I move?
 *    facet    — which projection of the same thing?
 *    readouts — what is its state right now?     (never clickable)
 *    config   — which settings govern this session?
 *    actions  — do a thing.                      (the primary action is last)
 *
 *  A Bases view KIND that contributes controls to the base's bar returns this object rather than
 *  rendering a bar of its own — see calendar/components/Toolbar.tsx and bases/FlashcardsView.tsx. */
export type ViewBarSlots = {
    identity?: JSX.Element
    locus?: JSX.Element
    facet?: JSX.Element
    readouts?: JSX.Element
    config?: JSX.Element
    actions?: JSX.Element
}

/** One extra class per named region/group, appended to that element's own class — the "parts"
 *  half of the parts-props pattern: an owner exposes a class per internal part instead of a
 *  consumer reaching a global class string. `lead`/`trail` are the two OUTER groups; the other six
 *  are the same slots `ViewBarSlots` names. */
export type ViewBarParts = Partial<
    Record<
        | 'lead'
        | 'identity'
        | 'locus'
        | 'facet'
        | 'trail'
        | 'readouts'
        | 'config'
        | 'actions',
        string
    >
>

export type ViewBarProps = ViewBarSlots & {
    /** Merged onto the root, so one caller can adjust one bar without forking the primitive. */
    class?: string
    /** One extra class per internal part — see `ViewBarParts`. A consumer that used to reach
     *  `:global(.vb-identity)` etc from its own stylesheet passes a local class here instead. */
    parts?: ViewBarParts
    /** No inline padding, passed straight to `Band`'s `flush`. For a host that owns the bar's side
     *  padding itself (BaseView) instead of zeroing it with a doubled selector. */
    flush?: boolean
}

/**
 * The --h-band (36px) view header: leading group (identity · locus · facet), trailing group
 * (readouts · config · actions), pushed apart by `justify-content: space-between`.
 *
 * WHY SLOTS AND NOT CHILDREN. The old API was `<ViewBar>{children}</ViewBar>` plus a
 * `<ViewBarSpacer/>` the caller had to remember to place. Three workarounds existed purely to
 * compensate: `.viewbar .crumb:has(+ .vbar-sp)` in ui.css, the calendar's `inline` prop and its own
 * `flex:1` spacer, and BaseView's conditional spacer/fallback pair. All three are gone — and the
 * two-`flex:1` hazard the calendar documented cannot be EXPRESSED any more, because `.vb-lead` is
 * the only flexible child by construction.
 */
function ViewBar(props: ViewBarProps) {
    // children(), NOT <Show when={props.identity}>. Reading a JSX prop for truthiness evaluates it
    // in the wrong scope; children() resolves it once, memoized, and correctly reports EMPTY when a
    // <Show> inside the slot rendered nothing — which is what keeps an unpopulated region from
    // emitting a wrapper and its gap.
    const identity = children(() => props.identity)
    const locus = children(() => props.locus)
    const facet = children(() => props.facet)
    const readouts = children(() => props.readouts)
    const config = children(() => props.config)
    const actions = children(() => props.actions)
    // A slot holding a FRAGMENT resolves to an ARRAY, and Solid keeps one entry per child even when
    // that child rendered nothing — `[undefined, undefined]` is what two collapsed <Show>s look
    // like. Length alone would call that populated and emit an empty region plus its gap, i.e. the
    // exact thing children() is here to prevent, so look at the entries rather than the count.
    const present = (v: JSX.Element) => v != null && v !== false && v !== ''
    const filled = (c: () => JSX.Element) => {
        const v = c()
        return Array.isArray(v) ? v.some(present) : present(v)
    }

    // PANE CHROME (ui/paneChrome.ts). Inside a pane the first bar to mount claims the pane's close +
    // drag, so a split pane shows ONE row — this bar — instead of PaneHeader stacked over it
    // repeating the same icon and name. Claimed synchronously in the body, not onMount, so
    // PaneLeaf never paints its fallback header for a frame first. An unsplit tab has no chrome,
    // so the bar is unchanged there.
    const pane = usePaneChrome()
    const me = Symbol('viewbar')
    if (pane) onCleanup(pane.claim(me))
    const ownsChrome = () => !!pane && pane.split() && pane.owner() === me
    // The bar is the drag handle, except where the press lands on something that is its own
    // control. TAG and attribute selectors only — a class name would be hashed and silently
    // match nothing (CLAUDE.md "Reach through the tree").
    const onPointerDown = (e: PointerEvent) => {
        if (!ownsChrome() || e.button !== 0) return
        const t = e.target as Element | null
        if (t?.closest('button, input, textarea, select, a, [contenteditable]'))
            return
        pane!.startDrag(e)
    }

    // THE FADE IS EARNED. Below the floor tier the lead group scrolls and its right edge fades to
    // say "more this way" — but only while there IS more that way. An unconditional mask faded the
    // last control of any lead that merely fit (the sidebar mini graph's brain-mode icons, read as a
    // dark band beside [clusters]). Re-measured on a resize of the lead or of anything in it, on a
    // slot's content changing, and on scroll, so the fade also drops once scrolled to the end.
    let lead!: HTMLDivElement
    const [overflowing, setOverflowing] = createSignal(false)
    onMount(() => {
        const measure = () => setOverflowing(leadOverflow(lead))
        const resize = new ResizeObserver(measure)
        const observeAll = () => {
            resize.disconnect()
            resize.observe(lead)
            for (const el of lead.children) resize.observe(el)
        }
        const mutation = new MutationObserver(() => {
            observeAll()
            measure()
        })
        observeAll()
        mutation.observe(lead, { childList: true, subtree: true, characterData: true })
        lead.addEventListener('scroll', measure, { passive: true })
        measure()
        onCleanup(() => {
            resize.disconnect()
            mutation.disconnect()
            lead.removeEventListener('scroll', measure)
        })
    })

    // FIT-DRIVEN DROP (ui/barFit.ts). The bar is measured with every droppable element shown, the
    // pure `dropsToFit` picks the levels to hide, and ViewBar stamps `data-bar-hidden` on those
    // elements. Widths are natural (measured shown), so un-hiding is stable: a width always maps to
    // the same result and nothing flip-flops at a threshold. [≡] (BarOverflow) exists only while
    // something is hidden. Skipped while the panel is open, because the dropped elements are then
    // living inside it.
    let trail!: HTMLDivElement
    const [panelOpen, setPanelOpen] = createSignal(false)
    const [dropped, setDropped] = createSignal<BarOverflowItem[]>([])
    const [probing, setProbing] = createSignal(false)
    let triggerWidth: number | undefined
    let refit = () => {}
    onMount(() => {
        const bar = lead.parentElement as HTMLElement
        const px = (v: string) => parseFloat(v) || 0
        let disposed = false
        // 0 width means no layout (display:none ancestor): not a measurement, so never cached.
        const measureTrigger = (gap: number) => {
            const t = trail.querySelector<HTMLElement>(':scope > [data-bar-overflow]')
            const w = t?.getBoundingClientRect().width ?? 0
            return w > 0 ? w + gap : undefined
        }
        /** The lead at its natural width, minus how far its crumb titles can still shrink: a title
         *  keeps 7ch, everything else in the lead is rigid. */
        const leadMinimum = () => {
            const prev = lead.style.flex
            lead.style.flex = '0 0 auto'
            const titles = [...lead.querySelectorAll<HTMLElement>('[data-bar-title]')]
            const saved = titles.map(b => b.style.cssText)
            for (const b of titles)
                b.style.cssText += ';max-width:7ch;min-width:0;flex:0 0 auto;overflow:hidden'
            const w = lead.getBoundingClientRect().width
            titles.forEach((b, i) => (b.style.cssText = saved[i]!))
            lead.style.flex = prev
            return Math.max(w, parseFloat(getComputedStyle(lead).minWidth) || 0)
        }
        const fit = () => {
            if (disposed || panelOpen()) return
            // No layout (the bar sits in a display:none ancestor): every width reads 0, which would
            // hide everything and cache a bogus trigger width. The ResizeObserver refits on show.
            if (!bar.clientWidth) return
            // Droppables live in the lead (locus, facet) as well as the trail.
            const els = [...bar.querySelectorAll<HTMLElement>('[data-bar-drop]')].filter(levelOf)
            const regions = [
                ...lead.querySelectorAll<HTMLElement>(':scope > [data-bar-region]'),
                ...trail.querySelectorAll<HTMLElement>(':scope > [data-bar-region]'),
            ]
            const apply = (hidden: number[]) => {
                for (const el of els)
                    el.toggleAttribute('data-bar-hidden', hidden.includes(levelOf(el)!))
                for (const r of regions) r.removeAttribute('data-bar-hidden')
                for (const r of regions) r.toggleAttribute('data-bar-hidden', regionEmpty(r))
            }
            const cs = getComputedStyle(bar)
            const gap = px(getComputedStyle(trail).columnGap)
            const colGap = px(cs.columnGap)
            const available = bar.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
            const trailWidth = () => trail.getBoundingClientRect().width
            // What the bar needs: the lead's minimum plus the trail, at the current hiding.
            const needed = () => leadMinimum() + colGap + trailWidth()
            // The trigger is taken out of every measurement, then put back untouched (it keeps focus).
            const trig = trail.querySelector<HTMLElement>(':scope > [data-bar-overflow]')
            let trigW = measureTrigger(gap) ?? triggerWidth
            if (trig) trig.style.display = 'none'
            apply([])
            const all = needed()
            let hidden: number[] = []
            if (all > available) {
                if (trigW === undefined) {
                    setProbing(true)
                    trigW = measureTrigger(gap)
                    setProbing(false)
                }
                if (trigW !== undefined) triggerWidth = trigW
                const widths = [all]
                const cumulative: number[] = []
                for (const level of BAR_DROP_LEVELS) {
                    cumulative.push(level)
                    apply(cumulative)
                    widths.push(needed())
                }
                hidden = dropsToFit({
                    available,
                    fixed: widths[widths.length - 1]!,
                    groups: BAR_DROP_LEVELS.map((level, i) => ({
                        level,
                        width: widths[i]! - widths[i + 1]!,
                    })),
                    trigger: trigW ?? 30,
                }).hiddenLevels
            }
            apply(hidden)
            if (trig) trig.style.display = ''
            setDropped(
                els
                    .filter(el => hidden.includes(levelOf(el)!))
                    .map(el => ({ el, label: menuLabel(el) }))
                    .filter(i => i.label),
            )
        }
        let queued = false
        refit = () => {
            if (queued) return
            queued = true
            queueMicrotask(() => {
                queued = false
                if (disposed) return
                fit()
                mutation.takeRecords() // our own probe/trigger churn is not a content change
            })
        }
        const resize = new ResizeObserver(() => {
            // The bar changed width: the panel closes (its anchor and its fit are stale), then refit.
            if (disposed) return
            if (panelOpen()) setPanelOpen(false)
            fit()
            mutation.takeRecords()
        })
        const mutation = new MutationObserver(refit)
        resize.observe(bar)
        mutation.observe(trail, { childList: true, subtree: true, characterData: true })
        mutation.observe(lead, { childList: true, subtree: true, characterData: true })
        document.fonts?.ready.then(() => {
            if (!disposed) refit()
        })
        onCleanup(() => {
            disposed = true
            resize.disconnect()
            mutation.disconnect()
        })
    })
    createEffect(on(panelOpen, open => open || refit(), { defer: true }))

    // Every region wrapper below carries `styles.vbRegion` in addition to its own slot class —
    // purely so the collapse ladder (ViewBar.module.css) can find "any of the six regions" without
    // a `[class^='vb-']` prefix match, which breaks the moment these classes are hashed (a hashed
    // local no longer starts with the literal "vb-"). `styles.vbRegion` is never referenced from
    // outside this file.
    return (
        <Band
            flush={props.flush}
            class={cx(styles.viewbar, props.class)}
            data-viewbar
            data-pane-chrome={ownsChrome() ? '' : undefined}
            data-pane-dim={ownsChrome() && !pane!.focused() ? '' : undefined}
            onPointerDown={onPointerDown}
        >
            <div
                ref={lead}
                class={cx(styles['vb-lead'], props.parts?.lead)}
                data-testid="vb-lead"
                data-overflowing={overflowing() ? '' : undefined}
            >
                <Show when={filled(identity)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-identity'], props.parts?.identity)}`}
                        data-testid="vb-identity"
                        data-bar-region
                    >
                        {identity()}
                    </div>
                </Show>
                <Show when={filled(locus)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-locus'], props.parts?.locus)}`}
                        data-testid="vb-locus"
                        data-bar-region
                    >
                        {locus()}
                    </div>
                </Show>
                <Show when={filled(facet)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-facet'], props.parts?.facet)}`}
                        data-testid="vb-facet"
                        data-bar-region
                    >
                        {facet()}
                    </div>
                </Show>
            </div>
            <div
                ref={trail}
                class={cx(styles['vb-trail'], props.parts?.trail)}
                data-testid="vb-trail"
            >
                <Show when={filled(readouts)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-readouts'], props.parts?.readouts)}`}
                        data-testid="vb-readouts"
                        data-bar-region
                    >
                        {readouts()}
                    </div>
                </Show>
                <Show when={filled(config)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-config'], props.parts?.config)}`}
                        data-testid="vb-config"
                        data-bar-region
                    >
                        {config()}
                    </div>
                </Show>
                <Show when={filled(actions)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-actions'], props.parts?.actions)}`}
                        data-testid="vb-actions"
                        data-bar-region
                    >
                        {actions()}
                    </div>
                </Show>
                {/* [≡]: only while a droppable element is hidden (or being measured). Before the pane's
                    [×], which stays the trail's outermost control. */}
                <Show when={dropped().length > 0 || probing()}>
                    <BarOverflow items={dropped()} open={panelOpen()} onOpenChange={setPanelOpen} />
                </Show>
                {/* The pane's [×]: last in the trail, after the primary action, and never on the
                    collapse ladder (no data-bar-drop, no vbRegion) — it is the only close a split
                    pane has. Handlers are PaneHeader.tsx's, verbatim. */}
                <Show when={ownsChrome()}>
                    <div class={styles['vb-pane']} data-testid="vb-pane">
                        <CloseButton
                            label="Close pane"
                            variant="unselected"
                            onPointerDown={e => e.stopPropagation()} // don't start a pane drag
                            onMouseDown={e => {
                                e.stopPropagation() // don't also trigger focus
                                e.preventDefault()
                                pane!.close()
                            }}
                        />
                    </div>
                </Show>
            </div>
        </Band>
    )
}

export default ViewBar

/** Breadcrumb: an optional leading icon + a bold title (the current view's name).
 *  The old `serif` prop is DELETED, not renamed: it had no production caller (only a story), and
 *  its rule set `--ui-font-stack` anyway, so it never rendered a serif. Written text in the prose
 *  face is `<Text register="prose">`'s job, not the crumb's. */
export function Crumb(props: {
    icon?: string
    iconSize?: number
    /** Merged onto the root, so a caller can restyle one instance without forking Crumb. */
    class?: string
    children: JSX.Element
}) {
    return (
        <span class={cx(styles.crumb, props.class)}>
            <Show when={props.icon}>
                {i => <Icon value={i()} size={props.iconSize} />}
            </Show>
            <b data-testid="crumb-title" data-bar-title>{props.children}</b>
        </span>
    )
}
