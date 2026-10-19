// The intro's morph overlay: paints a MorphPlan at progress p onto one canvas filling its positioned
// parent (the takeover root), on the same cell grid snapshotSlide measured (same origin, same
// --cell-w / --row-h). Art and rules paint on that grid; text paints one glyph at a time on its real
// footprint, sized so each run's monospace width equals the real line's, so the p=1 frame covers the
// incoming slide's words where they sit and the crossfade reads as the real face resolving. Colours
// resolve through GLYPH_COLOR_VARS from computed style, so a theme pick recolours it.
//
// `progress` pins the frame (VaultIntro drives it each rAF; stories freeze it). Absent, the overlay
// runs MORPH_MS from mount and calls `onDone`.
import { createEffect, onCleanup, onMount, type Component } from 'solid-js'
import { FONT_PX, CELL_H } from '../graph/asciiGrid'
import { rowRuns } from '../ui/ascii/glyphPaint'
import {
    GLYPH_COLORS,
    GLYPH_COLOR_VARS,
    createFrame,
    type GlyphFrame,
} from '../ui/ascii/glyphScene'
import { MORPH_MS, writeMorphFrame, type MorphGlyph } from './morph/morphFrame'
import type { MorphPlan } from './morph/morphPlan'
import { readMetrics } from './morph/snapshotSlide'
import styles from './MorphOverlay.module.css'

export type MorphOverlayProps = {
    plan: MorphPlan
    /** Pinned progress 0..1 (stories, the frozen-frame story). Absent = run MORPH_MS from mount,
     *  then call onDone. */
    progress?: number
    seed: number
    onDone?: () => void
    className?: string
}

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string }

const MorphOverlay: Component<MorphOverlayProps> = props => {
    let canvas!: HTMLCanvasElement
    let frame: GlyphFrame | undefined
    const fitted: MorphGlyph[] = []
    let live = 0
    let ro: ResizeObserver | undefined

    const paint = (p: number) => {
        const host = canvas.parentElement
        const ctx = canvas.getContext('2d') as SpacedContext | null
        if (!host || !ctx) return
        const m = readMetrics(host)
        const box = host.getBoundingClientRect()
        if (box.width < 1 || box.height < 1) return
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const bw = Math.round(box.width * dpr)
        const bh = Math.round(box.height * dpr)
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw
            canvas.height = bh
        }
        const plan = props.plan
        if (!frame || frame.cols !== plan.cols || frame.rows !== plan.rows) {
            frame = createFrame(plan.cols, plan.rows)
        }
        writeMorphFrame(plan, p, props.seed, frame, fitted)

        const cs = getComputedStyle(canvas)
        const colors = GLYPH_COLORS.map(
            name => cs.getPropertyValue(GLYPH_COLOR_VARS[name]).trim() || 'currentColor',
        )
        const stack = cs.getPropertyValue('--ui-font-stack').trim() || 'monospace'
        const fontPx = FONT_PX * (m.cellH / CELL_H)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, box.width, box.height)
        ctx.font = `${fontPx}px ${stack}`
        // Pin the advance to the snapshot's cell width (also turns ligatures off, which would fuse
        // "//" across two cells).
        if (typeof ctx.letterSpacing === 'string') {
            ctx.letterSpacing = '0px'
            const natural = ctx.measureText('0'.repeat(64)).width / 64
            ctx.letterSpacing = `${(m.cellW - natural).toFixed(4)}px`
        }
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        for (let row = 0; row < frame.rows; row++) {
            if (row >= m.rows) break
            const y = Math.round((row * m.cellH + m.cellH / 2) * dpr) / dpr
            for (const run of rowRuns(frame, row)) {
                const text = run.text.slice(0, Math.max(0, m.cols - run.col))
                if (!text) continue
                ctx.fillStyle = colors[run.color]
                ctx.globalAlpha = run.alpha / 255
                ctx.fillText(text, run.col * m.cellW, y)
            }
        }
        // Text on its footprint: each glyph centred in its own slot, the font scaled with the slot.
        if (typeof ctx.letterSpacing === 'string') ctx.letterSpacing = '0px'
        ctx.textAlign = 'center'
        let font = ''
        for (const g of fitted) {
            const f = `${(fontPx * g.scale).toFixed(2)}px ${stack}`
            if (f !== font) ctx.font = font = f
            ctx.fillStyle = colors[GLYPH_COLORS.indexOf(g.color)]
            ctx.globalAlpha = g.alpha / 255
            ctx.fillText(g.ch, (g.x + g.scale / 2) * m.cellW, Math.round(g.y * m.cellH * dpr) / dpr)
        }
        ctx.globalAlpha = 1
    }

    onMount(() => {
        if (typeof ResizeObserver === 'function' && canvas.parentElement) {
            ro = new ResizeObserver(() => paint(shown))
            ro.observe(canvas.parentElement)
        }
    })

    let shown = 0
    createEffect(() => {
        const pinned = props.progress
        if (pinned !== undefined) {
            shown = pinned
            paint(pinned)
            return
        }
        const t0 = performance.now()
        const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / MORPH_MS)
            shown = p
            paint(p)
            if (p >= 1) props.onDone?.()
            else live = requestAnimationFrame(tick)
        }
        paint(0)
        live = requestAnimationFrame(tick)
        onCleanup(() => cancelAnimationFrame(live))
    })
    onCleanup(() => ro?.disconnect())

    return (
        <canvas
            ref={canvas}
            aria-hidden="true"
            data-morph-skip
            data-morph-overlay
            class={`${styles['morph-overlay']} ${props.className ?? ''}`}
        />
    )
}

export default MorphOverlay
