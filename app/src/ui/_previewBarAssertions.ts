// app/src/ui/_previewBarAssertions.ts
// Story-only probes for preview/PreviewBar, shared by Preview/PreviewBar.stories.tsx (the bar alone)
// and App/PreviewView.stories.tsx (the bar as it ships, above a real PDF). Everything here reads
// the DOM the way a person sees it — rects, computed colours, glyph boxes — never a CSS-module
// class name, which hashes. ui/ViewBar.module.css's `.vb-trail`/`.crumb` family hashed for real
// (one-global-stylesheet followups, task 1), so the two probes that used to read those literal
// strings now key on the `data-testid="vb-trail"`/`"crumb-title"` hooks ViewBar.tsx renders
// instead — test-only, nothing in production reads either.

/** A painted element's box: false for `display: none` (dropped by the collapse ladder). */
const painted = (el: Element) => el.getClientRects().length > 0

/** The bar's CONTROLS in reading order: the page readout's button, every trail button, and the zoom
 *  percentage between − and + (a readout, but it occupies the row like a control does). */
export function barItems(bar: HTMLElement): HTMLElement[] {
    const trail = bar.querySelector('[data-testid="vb-trail"]') as HTMLElement | null
    if (!trail) return []
    const all = Array.from(trail.querySelectorAll<HTMLElement>('button, span, div')).filter(
        el =>
            painted(el) &&
            (el.tagName === 'BUTTON' ||
                (el.childElementCount === 0 && /^\d+%$/.test(el.textContent ?? ''))),
    )
    return all.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
}

/** A CSS custom property on `el`, resolved to px. */
export const tokenPx = (el: HTMLElement, name: string) =>
    parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0

/** `--accent` as the browser serialises a computed colour, so it compares against borderColor. */
export function accentColor(el: HTMLElement): string {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    el.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
}

/** The visible extent of one control, the thing a person measures spacing against: an icon button's
 *  glyph (its `svg`; the unpainted `[ ]` room around it is not ink), a lone percentage's text
 *  (a Range over its text nodes), a text button's own box (Button pulls its bracket bearing in, so
 *  its box edge is its `[` / `]` ink edge — pinned by the numbers in the task 4a report). */
export function inkRect(el: HTMLElement): DOMRect {
    const svg = el.querySelector('svg')
    if (svg && !(el.textContent ?? '').trim()) return svg.getBoundingClientRect()
    if (el.tagName !== 'BUTTON') {
        const range = document.createRange()
        range.selectNodeContents(el)
        return range.getBoundingClientRect()
    }
    return el.getBoundingClientRect()
}

/** An ink gap at or above this is a group seam; below it, a neighbour inside a group. The bar's two
 *  distances are 16px and 24px, so the cut sits between them. */
export const SEAM_INK_GAP = 22

/** Every within-group gap must sit this close to the median within-group gap (likewise seams). */
export const INK_GAP_TOLERANCE = 1

/** How much wider a seam must read than a within-group gap, ink to ink. */
export const SEAM_MARGIN = 5

/** The bar's design distances, ink to ink: neighbours inside a group, and across a group seam. */
export const WITHIN_INK_GAP = 16
export const SEAM_DESIGN_INK_GAP = 24

export const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0
}

export type BarProbe = {
    /** Horizontal distance between the BOXES of each pair of adjacent controls (diagnostic only —
     *  the bar's rule is about ink, below). */
    gaps: number[]
    /** Horizontal distance between the visible ink of each pair of adjacent controls. */
    inkGaps: number[]
    /** Ink gaps below SEAM_INK_GAP: neighbours inside a group. */
    withinGaps: number[]
    /** Ink gaps at or above SEAM_INK_GAP: one per group boundary. */
    seamGaps: number[]
    /** Within-group ink gaps farther than INK_GAP_TOLERANCE from their median. Want none. */
    unevenWithin: number[]
    /** Seam ink gaps farther than INK_GAP_TOLERANCE from their median. Want none. */
    unevenSeams: number[]
    /** Narrowest seam minus widest within-group gap, ink to ink; Infinity when either is absent.
     *  Want at least SEAM_MARGIN. */
    seamMargin: number
    /** Gaps the bar's rule rejects, as one list: uneven within, uneven seams, and a seam that does
     *  not stand clear of the within-group gaps. Want []. */
    strayGaps: number[]
    /** Seam count. */
    groupBoundaries: number
    /** Adjacent-control pairs INSIDE the annotate group (highlight/draw/scratch) — found
     *  structurally (painted buttons under `[data-testid="preview-annotate"]`, not by gap value: its internal
     *  gap is the same as every other group's, so a pixel probe cannot tell it apart). 2 painted buttons -> 1 gap, 3 -> 2. Each one still has to land
     *  among the within-group ink gaps, which `strayGaps` already enforces. */
    annotateGaps: number
    /** Elements in the bar painting an accent border. DESIGN.md: "states are colour and weight,
     *  nothing drawn" — under the button family a selected control draws no border/frame, so this
     *  is expected to be 0 everywhere, at rest and with any toggle on. A non-zero reading means a
     *  border/box came back onto a selected control (e.g. `.btn--icon.btn--selected` in
     *  Button.module.css), which is exactly the regression this probe exists to catch. */
    frames: number
    /** Button-family controls in the bar currently `selected` (a toggle that is ON) —
     *  `data-state="selected"` is the runtime hook Button.tsx stamps on the root. Use this where a
     *  story wants to assert a mode is on; it says nothing about whether a border is drawn. */
    selectedCount: number
    /** Distinct rendered sizes (`WxH`) of every trail glyph. Want exactly one. */
    glyphSizes: string[]
    /** Distinct box sizes of the icon-only controls. Want exactly one. */
    /** Distinct icon-only button heights across the whole bar (one expected). */
    iconHeights: number[]
    /** Distinct widths per state: `normal` bare glyph buttons, `toggle` (data-state selected/unselected). */
    iconWidths: { normal: number[]; toggle: number[] }
    /** Controls whose rect leaves the bar's rect. Want none. */
    outside: string[]
    /** Pairs of controls that overlap. Want none. */
    overlaps: string[]
    /** Largest |control centre − bar centre| on the y axis. */
    maxCentreOffset: number
    crumbWidth: number
}

const nameOf = (el: HTMLElement) =>
    el.getAttribute('aria-label') || el.textContent || el.tagName

export function probeBar(bar: HTMLElement): BarProbe {
    const items = barItems(bar)
    const rects = items.map(el => el.getBoundingClientRect())
    const gaps = rects.slice(1).map((r, i) => Math.round((r.left - rects[i]!.right) * 10) / 10)
    const inks = items.map(inkRect)
    const inkGaps = inks
        .slice(1)
        .map((r, i) => Math.round((r.left - inks[i]!.right) * 10) / 10)
    const withinGaps = inkGaps.filter(g => g < SEAM_INK_GAP)
    const seamGaps = inkGaps.filter(g => g >= SEAM_INK_GAP)
    const uneven = (xs: number[]) => {
        const m = median(xs)
        return xs.filter(g => Math.abs(g - m) > INK_GAP_TOLERANCE)
    }
    const unevenWithin = uneven(withinGaps)
    const unevenSeams = uneven(seamGaps)
    const seamMargin =
        withinGaps.length && seamGaps.length
            ? Math.min(...seamGaps) - Math.max(...withinGaps)
            : Infinity
    const strayGaps = [
        ...unevenWithin,
        ...unevenSeams,
        ...(seamMargin < SEAM_MARGIN ? [seamMargin] : []),
    ]
    const accent = accentColor(bar)
    const frames = Array.from(bar.querySelectorAll<HTMLElement>('*')).filter(el => {
        if (!painted(el)) return false
        const cs = getComputedStyle(el)
        return (
            parseFloat(cs.borderTopWidth) > 0 &&
            cs.borderTopStyle !== 'none' &&
            cs.borderTopColor === accent
        )
    }).length
    const selectedCount = Array.from(
        bar.querySelectorAll<HTMLElement>('[data-state="selected"]'),
    ).filter(painted).length
    const trail = bar.querySelector('[data-testid="vb-trail"]') as HTMLElement
    const glyphSizes = [
        ...new Set(
            Array.from(trail.querySelectorAll('svg'))
                .filter(painted)
                .map(s => {
                    const r = s.getBoundingClientRect()
                    return `${Math.round(r.width)}x${Math.round(r.height)}`
                }),
        ),
    ]
    const iconOnly = items
        .filter(el => el.tagName === 'BUTTON' && !(el.textContent ?? '').trim())
        .map(el => {
            const r = el.getBoundingClientRect()
            return {
                toggle: el.dataset.state === 'selected' || el.dataset.state === 'unselected',
                w: Math.round(r.width),
                h: Math.round(r.height),
            }
        })
    const uniq = (xs: number[]) => [...new Set(xs)]
    const iconHeights = uniq(iconOnly.map(i => i.h))
    const iconWidths = {
        normal: uniq(iconOnly.filter(i => !i.toggle).map(i => i.w)),
        toggle: uniq(iconOnly.filter(i => i.toggle).map(i => i.w)),
    }
    const b = bar.getBoundingClientRect()
    const outside = items
        .filter((_, i) => {
            const r = rects[i]!
            return (
                r.left < b.left - 0.5 ||
                r.right > b.right + 0.5 ||
                r.top < b.top - 0.5 ||
                r.bottom > b.bottom + 0.5
            )
        })
        .map(nameOf)
    const overlaps: string[] = []
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]!
            const c = rects[j]!
            const w = Math.min(a.right, c.right) - Math.max(a.left, c.left)
            const h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top)
            if (w > 0.5 && h > 0.5) overlaps.push(`${nameOf(items[i]!)} × ${nameOf(items[j]!)}`)
        }
    }
    const centre = (b.top + b.bottom) / 2
    const maxCentreOffset = Math.max(0, ...rects.map(r => Math.abs((r.top + r.bottom) / 2 - centre)))
    const title = bar.querySelector('[data-testid="crumb-title"]') as HTMLElement | null
    const annotate = bar.querySelector('[data-testid="preview-annotate"]') as HTMLElement | null
    const annotateButtons = annotate
        ? Array.from(annotate.querySelectorAll<HTMLElement>('button')).filter(painted)
        : []
    return {
        gaps,
        inkGaps,
        withinGaps,
        seamGaps,
        unevenWithin,
        unevenSeams,
        seamMargin,
        strayGaps,
        groupBoundaries: seamGaps.length,
        annotateGaps: Math.max(0, annotateButtons.length - 1),
        frames,
        selectedCount,
        glyphSizes,
        iconHeights,
        iconWidths,
        outside,
        overlaps,
        maxCentreOffset,
        crumbWidth: title?.getBoundingClientRect().width ?? 0,
    }
}
