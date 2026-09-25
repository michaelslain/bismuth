// app/src/ui/ViewBar.tsx
// The canonical view header used across content views (graph, bases, calendar,
// flashcards, …): a leading group (identity · locus · facet) and a trailing group
// (readouts · config · actions), composed through NAMED SLOTS rather than positional
// children. Replaces per-view bespoke `.viewbar` markup so every header is
// structurally identical.
import { children, type JSX, Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import styles from './ViewBar.module.css'

/** Appends an optional extra class to a base (hashed) one — used throughout for the `class`/
 *  `parts` merge pattern every region and primitive here takes. */
const cx = (base: string, extra?: string): string =>
    extra ? `${base} ${extra}` : base

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

    // Every region wrapper below carries `styles.vbRegion` in addition to its own slot class —
    // purely so the collapse ladder (ViewBar.module.css) can find "any of the six regions" without
    // a `[class^='vb-']` prefix match, which breaks the moment these classes are hashed (a hashed
    // local no longer starts with the literal "vb-"). `styles.vbRegion` is never referenced from
    // outside this file.
    return (
        <div class={cx(styles.viewbar, props.class)} data-viewbar>
            <div
                class={cx(styles['vb-lead'], props.parts?.lead)}
                data-testid="vb-lead"
            >
                <Show when={filled(identity)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-identity'], props.parts?.identity)}`}
                        data-testid="vb-identity"
                    >
                        {identity()}
                    </div>
                </Show>
                <Show when={filled(locus)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-locus'], props.parts?.locus)}`}
                        data-testid="vb-locus"
                    >
                        {locus()}
                    </div>
                </Show>
                <Show when={filled(facet)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-facet'], props.parts?.facet)}`}
                        data-testid="vb-facet"
                    >
                        {facet()}
                    </div>
                </Show>
            </div>
            <div
                class={cx(styles['vb-trail'], props.parts?.trail)}
                data-testid="vb-trail"
            >
                <Show when={filled(readouts)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-readouts'], props.parts?.readouts)}`}
                        data-testid="vb-readouts"
                    >
                        {readouts()}
                    </div>
                </Show>
                <Show when={filled(config)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-config'], props.parts?.config)}`}
                        data-testid="vb-config"
                    >
                        {config()}
                    </div>
                </Show>
                <Show when={filled(actions)}>
                    <div
                        class={`${styles.vbRegion} ${cx(styles['vb-actions'], props.parts?.actions)}`}
                        data-testid="vb-actions"
                    >
                        {actions()}
                    </div>
                </Show>
            </div>
        </div>
    )
}

export default ViewBar

/** Breadcrumb: an optional leading icon + a bold title (the current view's name).
 *  `serif` renders the title in the editor serif (e.g. the standalone calendar month). */
export function Crumb(props: {
    icon?: string
    iconSize?: number
    serif?: boolean
    /** Merged onto the root, so a caller can restyle one instance without forking Crumb. */
    class?: string
    children: JSX.Element
}) {
    return (
        <span class={cx(styles.crumb, props.class)}>
            <Show when={props.icon}>
                {i => <Icon value={i()} size={props.iconSize} />}
            </Show>
            <b
                classList={{ [styles['crumb-serif']]: !!props.serif }}
                data-testid="crumb-title"
            >
                {props.children}
            </b>
        </span>
    )
}
