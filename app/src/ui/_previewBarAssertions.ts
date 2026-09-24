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

export type BarProbe = {
    /** Horizontal distance between each pair of adjacent controls. */
    gaps: number[]
    iconGap: number
    crumbGap: number
    /** Gaps that are neither known token (±0.5px). Want 0. */
    strayGaps: number[]
    /** Gaps equal to --bar-crumb-gap: one per group boundary. */
    groupBoundaries: number
    /** Adjacent-control pairs INSIDE the annotate group (highlight/draw/scratch) — found
     *  structurally (painted buttons under `[data-testid="preview-annotate"]`, not by gap value:
     *  the annotate group's internal gap is `iconGap`, same as every other group, so a pixel probe
     *  can no longer tell it apart). 2 painted buttons -> 1 gap, 3 -> 2. Each one still has to land
     *  in `iconGap`, which `strayGaps` already enforces. */
    annotateGaps: number
    /** Button-family controls in the bar currently `selected` (a toggle that is ON) — DESIGN.md:
     *  "states are colour and weight, nothing drawn", so a selected control draws no border/frame
     *  any more (the pre-button-family `VBtn.active` accent outline this once measured is gone);
     *  `data-state="selected"` is the runtime hook Button.tsx stamps on the root instead. */
    frames: number
    /** Distinct rendered sizes (`WxH`) of every trail glyph. Want exactly one. */
    glyphSizes: string[]
    /** Distinct box sizes of the icon-only controls. Want exactly one. */
    iconBoxes: string[]
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
    const iconGap = tokenPx(bar, '--bar-icon-gap')
    const crumbGap = tokenPx(bar, '--bar-crumb-gap')
    const gaps = rects.slice(1).map((r, i) => Math.round((r.left - rects[i]!.right) * 10) / 10)
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.5
    const frames = Array.from(
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
    const iconBoxes = [
        ...new Set(
            items
                .filter(el => el.tagName === 'BUTTON' && !(el.textContent ?? '').trim())
                .map(el => {
                    const r = el.getBoundingClientRect()
                    return `${Math.round(r.width)}x${Math.round(r.height)}`
                }),
        ),
    ]
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
        iconGap,
        crumbGap,
        strayGaps: gaps.filter(g => !near(g, iconGap) && !near(g, crumbGap)),
        groupBoundaries: gaps.filter(g => near(g, crumbGap)).length,
        annotateGaps: Math.max(0, annotateButtons.length - 1),
        frames,
        glyphSizes,
        iconBoxes,
        outside,
        overlaps,
        maxCentreOffset,
        crumbWidth: title?.getBoundingClientRect().width ?? 0,
    }
}
