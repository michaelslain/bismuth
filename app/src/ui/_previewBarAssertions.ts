// app/src/ui/_previewBarAssertions.ts
// Story-only probes for preview/PreviewBar, shared by Preview/PreviewBar.stories.tsx (the bar alone)
// and App/PreviewView.stories.tsx (the bar as it ships, above a real PDF). Everything here reads
// the DOM the way a person sees it — rects, computed colours, glyph boxes — and never a CSS-module
// class name, which hashes (the bar's own module has exactly one importer: PreviewBar.tsx).

/** A painted element's box: false for `display: none` (dropped by the collapse ladder). */
const painted = (el: Element) => el.getClientRects().length > 0

/** The bar's CONTROLS in reading order: the page readout's button, every trail button, and the zoom
 *  percentage between − and + (a readout, but it occupies the row like a control does). */
export function barItems(bar: HTMLElement): HTMLElement[] {
    const trail = bar.querySelector('.vb-trail') as HTMLElement | null
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

export type BarProbe = {
    /** Horizontal distance between each pair of adjacent controls. */
    gaps: number[]
    iconGap: number
    crumbGap: number
    /** `--sp-1`, the annotate group's own hairline gap (highlight/draw/scratch) — keeps two
     *  adjacent ON toggles from reading as one fused accent frame. Every other group's internal
     *  gap is `iconGap` (0). */
    annotateGap: number
    /** Gaps that are none of the three known tokens (±0.5px). Want 0. */
    strayGaps: number[]
    /** Gaps equal to --bar-crumb-gap: one per group boundary. */
    groupBoundaries: number
    /** Gaps equal to the annotate group's own --sp-1 hairline: one per adjacent pair of controls
     *  INSIDE that group (2 controls -> 1, 3 controls -> 2). */
    annotateGaps: number
    /** Elements in the bar painting an accent border. */
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
    const annotateGap = tokenPx(bar, '--sp-1')
    const gaps = rects.slice(1).map((r, i) => Math.round((r.left - rects[i]!.right) * 10) / 10)
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.5
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
    const trail = bar.querySelector('.vb-trail') as HTMLElement
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
    const title = bar.querySelector('.crumb b') as HTMLElement | null
    return {
        gaps,
        iconGap,
        crumbGap,
        annotateGap,
        strayGaps: gaps.filter(
            g => !near(g, iconGap) && !near(g, crumbGap) && !near(g, annotateGap),
        ),
        groupBoundaries: gaps.filter(g => near(g, crumbGap)).length,
        annotateGaps: gaps.filter(g => near(g, annotateGap)).length,
        frames,
        glyphSizes,
        iconBoxes,
        outside,
        overlaps,
        maxCentreOffset,
        crumbWidth: title?.getBoundingClientRect().width ?? 0,
    }
}
