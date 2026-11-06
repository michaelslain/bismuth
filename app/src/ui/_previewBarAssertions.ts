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
    // A segmented switch is one control: its segments sit closer than controls do, by design, so
    // it is measured as one item, its own box.
    const segmented = (el: HTMLElement) => el.closest<HTMLElement>('[data-segmented]')
    const all = Array.from(trail.querySelectorAll<HTMLElement>('button, span, div')).filter(
        el =>
            painted(el) &&
            !segmented(el) &&
            (el.tagName === 'BUTTON' ||
                (el.childElementCount === 0 && /^\d+%$/.test(el.textContent ?? ''))),
    )
    const switches = Array.from(trail.querySelectorAll<HTMLElement>('[data-segmented]')).filter(painted)
    return [...all, ...switches].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
}

/** A CSS custom property on `el`, resolved to px. */
export const tokenPx = (el: HTMLElement, name: string) =>
    parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0

/** `--text-muted` as the browser serialises a computed colour: the bar's one resting ink. */
export function mutedColor(el: HTMLElement): string {
    const probe = document.createElement('span')
    probe.style.color = 'var(--text-muted)'
    el.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
}

/** `--accent` as the browser serialises a computed colour, so it compares against borderColor. */
export function accentColor(el: HTMLElement): string {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    el.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
}

/** An icon-only button of the family. Keyed on Button's `data-kind` runtime hook, never on text:
 *  ui/IconBrackets draws an icon's `[` `]` as real aria-hidden spans, so an icon button's
 *  textContent is `[]` whether those brackets paint (ON) or only hold their room (off, `bracketRoom`). */
const isIconButton = (el: HTMLElement) => el.tagName === 'BUTTON' && el.dataset.kind === 'icon'

/** The visible extent of one control, the thing a person measures spacing against: an icon button's
 *  glyph (its `svg` — the `[ ]` room around it is not ink, and an ON toggle's painted brackets are
 *  measured as state, not as position: the bar's rhythm is glyph to glyph whatever is selected), a
 *  lone percentage's text (a Range over its text nodes), a text button's own box (Button pulls its
 *  bracket bearing in, so its box edge is its `[` / `]` ink edge). */
export function inkRect(el: HTMLElement): DOMRect {
    const svg = el.querySelector('svg')
    if (svg && isIconButton(el)) {
        // The svg BOX is wider than the painted glyph (a library icon keeps ~1.2px of air inside its
        // 12px box each side, and each glyph a different amount), so a box-to-box gap reads short of
        // what a person, or a screenshot's outermost non-background pixel columns, measures. The
        // union of the drawn shapes' own boxes is the glyph's real horizontal extent.
        const shapes = Array.from(
            svg.querySelectorAll<SVGGraphicsElement>('path, circle, rect, line, polyline, polygon, ellipse'),
        ).map(n => n.getBoundingClientRect()).filter(r => r.width > 0 || r.height > 0)
        const box = svg.getBoundingClientRect()
        if (!shapes.length) return box
        const left = Math.min(...shapes.map(r => r.left))
        const right = Math.max(...shapes.map(r => r.right))
        return new DOMRect(left, box.top, right - left, box.height)
    }
    // A QUIET text button (`fit`) paints no brackets at rest (its `::before` is hidden), so its ink is the label alone.
    if (el.tagName !== 'BUTTON' || getComputedStyle(el, '::before').visibility === 'hidden') return textRange(el).getBoundingClientRect()
    return el.getBoundingClientRect()
}

/** A Range over the element's own text nodes (never its `::before`/`::after` brackets). */
function textRange(el: HTMLElement): Range {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let first: Text | null = null
    let last: Text | null = null
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n.textContent ?? '').trim()) continue
        first ??= n as Text
        last = n as Text
    }
    const range = document.createRange()
    if (first && last) {
        range.setStart(first, 0)
        range.setEnd(last, last.textContent!.length)
    } else {
        range.selectNodeContents(el)
    }
    return range
}

let measureCtx: CanvasRenderingContext2D | null = null

/** The vertical centre a person reads a control on: an icon's glyph centre, or a text run's
 *  x-height box centre (baseline minus half the x-height, from the run's own font metrics). One
 *  optical line means every control's centre sits within OPTICAL_LINE_TOLERANCE of the others. */
export function opticalCentre(el: HTMLElement): number {
    const svg = el.querySelector('svg')
    if (svg && isIconButton(el)) {
        const r = svg.getBoundingClientRect()
        return (r.top + r.bottom) / 2
    }
    const range = textRange(el)
    const r = range.getBoundingClientRect()
    const host = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : el) ?? el
    const cs = getComputedStyle(host)
    measureCtx ??= document.createElement('canvas').getContext('2d')
    const ctx = measureCtx!
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const m = ctx.measureText('x')
    return r.top + m.fontBoundingBoxAscent - m.actualBoundingBoxAscent / 2
}

/** Every control's optical centre must sit within this many px of every other's. */
export const OPTICAL_LINE_TOLERANCE = 1

/** An ink gap at or above this is a seam the bar must not have: every control sits one distance
 *  (~16.5px, ink to ink) from its neighbour, so a gap this wide is a stray wider gap. */
export const SEAM_INK_GAP = 22

/** Every ink gap must sit this close to the median gap. */
export const INK_GAP_TOLERANCE = 1

/** The bar's one design distance, ink to ink, between every pair of neighbouring controls. Not a
 *  whole pixel, because every icon's unpainted bracket room is ui/IconBrackets' recipe in em (~4.3px
 *  a side at the bar's 11.5px icon font): icon to icon is --bar-icon-gap (8) + two rooms, less the
 *  `.tools` ink inset. Measured from screenshot pixels (outermost non-background columns of each
 *  glyph or text run): 15.5-17.5, the same distance as the drawing dock. */
export const WITHIN_INK_GAP = 16.5

export const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    if (!s.length) return 0
    const mid = (s.length - 1) / 2
    return (s[Math.floor(mid)]! + s[Math.ceil(mid)]!) / 2
}

export type BarProbe = {
    /** Horizontal distance between the BOXES of each pair of adjacent controls (diagnostic only —
     *  the bar's rule is about ink, below). */
    gaps: number[]
    /** Horizontal distance between the visible ink of each pair of adjacent controls. */
    inkGaps: number[]
    /** Ink gaps below SEAM_INK_GAP: every neighbour pair, when the bar is right. */
    withinGaps: number[]
    /** Ink gaps at or above SEAM_INK_GAP: stray wide gaps. Want none. */
    seamGaps: number[]
    /** Ink gaps farther than INK_GAP_TOLERANCE from their median. Want none. */
    unevenWithin: number[]
    /** Gaps the bar's rule rejects, as one list: uneven gaps and stray wide ones. Want []. */
    strayGaps: number[]
    /** Stray wide-gap count. Want 0. */
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
    /** Distinct resting ink colours of the bar's controls that are not selected and not disabled.
     *  The bar is one tone family at rest, so want exactly one (--text-muted). */
    restTones: string[]
    /** Largest minus smallest optical centre across the controls (icon glyph centre, text x-height
     *  centre). Want at most OPTICAL_LINE_TOLERANCE. */
    lineSpread: number
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
    const strayGaps = [
        ...unevenWithin,
        ...seamGaps,
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
    // A segmented switch always shows its value as a selected segment; that is a choice, not a
    // tool switched on, so it is not counted.
    const selectedCount = Array.from(
        bar.querySelectorAll<HTMLElement>('[data-state="selected"]'),
    ).filter(el => painted(el) && !el.closest('[data-segmented]')).length
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
        .filter(isIconButton)
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
    const resting = items.filter(el => el.dataset.state !== 'selected' && !(el as HTMLButtonElement).disabled)
    const restTones = [...new Set(resting.map(el => getComputedStyle(el).color))]
    const centres = items.map(opticalCentre)
    const lineSpread = centres.length ? Math.max(...centres) - Math.min(...centres) : 0
    return {
        restTones,
        lineSpread,
        gaps,
        inkGaps,
        withinGaps,
        seamGaps,
        unevenWithin,
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
