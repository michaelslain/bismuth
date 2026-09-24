// app/src/daemon/DaemonOverview.tsx
// The daemon page's right column: inbox, crons, services, log stacked top to bottom, each an
// opaque `DaemonSection` handed in by the caller — this component owns only the stack's layout,
// never the list components themselves (DaemonPageHost wires those in). ONE scroll for the whole
// column — no section scrolls on its own. Each slot is a row-limited list that shows its first N
// rows then a `+N more // show` line; this component measures its own height, works out how many
// rows each section can show at rest (daemonRowBudget.ts's `allocateRows`), and hands each slot
// an accessor for its limit — `undefined` means "show every row". Narrow (DaemonPage's `.page`
// size container below 760px) drops the measurement for a static per-section cap instead:
// measuring this component's own height there is a feedback loop, since the stage scrolls as a
// whole and this component's height is `auto`.
import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import styles from './DaemonOverview.module.css'
import { allocateRows, rowUnits, type RowLimit } from './daemonRowBudget'

export type DaemonSectionKey = 'inbox' | 'crons' | 'services' | 'log'

export type DaemonSectionRows = {
    /** Rows the section has in total (its own badge count). */
    total: number
    /** Rows that need the user's attention — the limit never cuts below this many. */
    attention: number
    /** Extra trailing lines the section renders below its rows that also cost a row of height
     *  (the inbox's `N resolved // show` line). Defaults to 0. */
    extraLines?: number
}

export type DaemonOverviewProps = {
    rows: Record<DaemonSectionKey, DaemonSectionRows>
    /** Each slot is a function of the section's computed limit, so Solid can re-read the
     *  accessor reactively inside the JSX without the list itself being re-created (which would
     *  lose its expanded state). */
    inbox: (limit: () => RowLimit) => JSX.Element
    crons: (limit: () => RowLimit) => JSX.Element
    services: (limit: () => RowLimit) => JSX.Element
    log: (limit: () => RowLimit) => JSX.Element
    class?: string
}

const SECTION_KEYS: DaemonSectionKey[] = ['inbox', 'crons', 'services', 'log']

/** Narrow: the stage scrolls as a whole and this component's own height is `auto`, so measuring
 *  it would be a feedback loop. Static per-section caps instead, each raised to at least its
 *  attention count, and lifted entirely once the section's rows already fit under the cap. */
const NARROW_CAPS: Record<DaemonSectionKey, number> = {
    inbox: 5,
    crons: 5,
    services: 5,
    log: 10,
}

function narrowLimits(rows: Record<DaemonSectionKey, DaemonSectionRows>): RowLimit[] {
    return SECTION_KEYS.map(key => {
        const r = rows[key]
        const cap = Math.max(NARROW_CAPS[key], r.attention)
        return r.total <= cap ? undefined : cap
    })
}

function DaemonOverview(props: DaemonOverviewProps) {
    let el: HTMLDivElement | undefined
    const [limits, setLimits] = createSignal<RowLimit[]>(SECTION_KEYS.map(() => undefined))

    const measure = () => {
        if (!el) return
        const cs = getComputedStyle(el)
        const fit = cs.getPropertyValue('--overview-fit').trim() !== '0'
        if (!fit) {
            setLimits(narrowLimits(props.rows))
            return
        }
        const rowH = parseFloat(cs.getPropertyValue('--row-h')) || 0
        const sp1 = parseFloat(cs.getPropertyValue('--sp-1')) || 0
        const sp2 = parseFloat(cs.getPropertyValue('--sp-2')) || 0
        const sp6 = parseFloat(cs.getPropertyValue('--sp-6')) || 0
        const pitch = rowH + 2 * sp1
        const needs = SECTION_KEYS.map(key => props.rows[key])
        const headings = 4 * (rowH + sp2)
        const gaps = 3 * sp6
        const emptyLines = needs.reduce((a, r) => a + (r.total === 0 ? 1 : 0), 0) * pitch
        const extraLines = needs.reduce((a, r) => a + (r.extraLines ?? 0), 0) * pitch
        const overhead = headings + gaps + emptyLines + extraLines
        const available = rowUnits(el.clientHeight, overhead, pitch)
        setLimits(
            allocateRows(
                available,
                needs.map(r => ({ total: r.total, floor: Math.max(3, r.attention) })),
            ),
        )
    }

    onMount(() => {
        if (!el) return
        const ro = new ResizeObserver(() => measure())
        ro.observe(el)
        onCleanup(() => ro.disconnect())
    })

    // Re-measure on a data change too (a poll landing new totals), not only on a resize.
    createEffect(() => {
        void props.rows
        measure()
    })

    const limitFor = (key: DaemonSectionKey) => () => limits()[SECTION_KEYS.indexOf(key)]

    return (
        <div ref={el} class={`${styles.overview} ${props.class ?? ''}`} data-testid="daemon-overview">
            <div class={styles.slot}>{props.inbox(limitFor('inbox'))}</div>
            <div class={styles.slot}>{props.crons(limitFor('crons'))}</div>
            <div class={styles.slot}>{props.services(limitFor('services'))}</div>
            <div class={styles.slot}>{props.log(limitFor('log'))}</div>
        </div>
    )
}

export default DaemonOverview
