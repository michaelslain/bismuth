// app/src/ui/ascii/glyphCanvas.ts
// Paints a GlyphScene (pure: time -> characters) onto one transparent <canvas> filling a host, on
// the SAME cell grid the ASCII graph uses (CELL_W/CELL_H/FONT_PX scaled by fitScale to fit the box, floored at COMPACT_FLOOR_SCALE and capped at MAX_SCALE, letter-spacing
// pinned to the cell advance). Re-implemented to match AsciiGraphRenderer, not imported from it.
// The ground is never painted: the page behind the canvas is the ground, so every theme just works.
//
// Colour names in a scene resolve to the theme's CSS vars (GLYPH_COLOR_VARS), re-read whenever
// documentElement's `style` attribute changes (App re-applies the theme vars there) — the same
// watch GraphAtmosphere uses.
import { CELL_H, CELL_W, FONT_PX } from '../../graph/asciiGrid'
import { clampDprToCanvasArea, isUsableBox } from '../../graph/graphFit'
import {
    AMBIENT_FPS,
    GLYPH_COLORS,
    GLYPH_COLOR_VARS,
    createFrame,
    type GlyphFrame,
    type GlyphScene,
} from './glyphScene'
import {
    fitScale,
    fitScene,
    frameInterval,
    rowRuns,
    shouldRun,
} from './glyphPaint'

type SpacedContext = CanvasRenderingContext2D & { letterSpacing?: string }

export default class GlyphCanvas {
    private host: HTMLElement | null = null
    private canvas: HTMLCanvasElement | null = null
    private ctx: CanvasRenderingContext2D | null = null
    private scene: GlyphScene | null = null
    private buf: GlyphFrame | null = null

    private active = true
    private pinned: number | undefined = undefined
    private hidden = false
    private reduced = false
    private mql: MediaQueryList | null = null
    private dprMql: MediaQueryList | null = null

    private raf = 0
    private t0 = 0
    private lastPaint = -Infinity
    private frameErrorLogged = false

    private ro: ResizeObserver | null = null
    private mo: MutationObserver | null = null

    private fontStack = 'monospace'
    private baseCellH = CELL_H
    /** One CSS colour per GLYPH_COLORS entry. 'currentColor' is the unresolved fallback. */
    private colors: string[] = GLYPH_COLORS.map(() => 'currentColor')

    private W = 0
    private H = 0
    private dpr = 1
    private cellW = CELL_W
    private cellH = CELL_H
    private scale = 1
    private cols = 0
    private rows = 0

    mount(host: HTMLElement): void {
        if (this.host) return
        this.host = host
        const canvas = document.createElement('canvas')
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'
        canvas.setAttribute('aria-hidden', 'true')
        host.appendChild(canvas)
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')

        this.hidden = document.visibilityState === 'hidden'
        document.addEventListener('visibilitychange', this.onVisibility)
        if (typeof matchMedia === 'function') {
            this.mql = matchMedia('(prefers-reduced-motion: reduce)')
            this.reduced = this.mql.matches
            this.mql.addEventListener('change', this.onReduced)
        }

        this.watchDpr()
        this.readTokens()

        if (typeof ResizeObserver === 'function') {
            this.ro = new ResizeObserver(this.onResize)
            this.ro.observe(host)
        }
        if (typeof MutationObserver === 'function') {
            this.mo = new MutationObserver(this.onTheme)
            this.mo.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['style'],
            })
        }
        document.fonts?.ready.then(() => {
            if (this.host) {
                this.readTokens()
                this.refresh()
            }
        })
        this.refresh()
    }

    /** Resets the clock to t = 0 and draws frame(0). */
    setScene(scene: GlyphScene): void {
        this.scene = scene
        this.buf = createFrame(scene.cols, scene.rows)
        this.t0 = performance.now()
        this.lastPaint = -Infinity
        this.frameErrorLogged = false
        this.refresh()
    }

    setVisible(active: boolean): void {
        if (this.active === active) return
        this.active = active
        this.refresh()
    }

    /** Pin time: draw frame(t) once and stop the loop. undefined = live. */
    setTime(t: number | undefined): void {
        this.pinned = t
        if (t === undefined) this.t0 = performance.now()
        this.lastPaint = -Infinity
        this.refresh()
    }

    destroy(): void {
        this.stopLoop()
        this.ro?.disconnect()
        this.mo?.disconnect()
        this.ro = null
        this.mo = null
        document.removeEventListener('visibilitychange', this.onVisibility)
        this.mql?.removeEventListener('change', this.onReduced)
        this.mql = null
        this.dprMql?.removeEventListener('change', this.onDpr)
        this.dprMql = null
        this.canvas?.remove()
        this.canvas = null
        this.ctx = null
        this.host = null
        this.scene = null
        this.buf = null
    }

    // ---- state -> paint ---------------------------------------------------------------------

    /** Re-evaluate what the canvas should be doing after any state change: draw the right static
     *  frame now, and (re)start the loop only if it should run. */
    private refresh() {
        this.stopLoop()
        if (!this.host || !this.scene) return
        this.draw(this.timeNow())
        if (this.loopWanted()) this.raf = requestAnimationFrame(this.tick)
    }

    private loopWanted(): boolean {
        return (
            this.pinned === undefined &&
            shouldRun(this.active, this.hidden, this.reduced)
        )
    }

    /** The time a static redraw should show: the pin, else the final frame under reduced motion,
     *  else the live clock. */
    private timeNow(): number {
        if (this.pinned !== undefined) return this.pinned
        if (this.reduced && this.scene) return this.scene.revealMs
        return performance.now() - this.t0
    }

    private stopLoop() {
        if (this.raf) cancelAnimationFrame(this.raf)
        this.raf = 0
    }

    /** One rAF turn. Rescheduling is in `finally` and the frame is caught inside draw(), so a throw
     *  cannot end the animation. Ambient paces to AMBIENT_FPS; the reveal paints every rAF. */
    private tick = (now: number) => {
        this.raf = 0
        try {
            const scene = this.scene
            if (!scene) return
            const t = Math.max(0, now - this.t0)
            const ambient = t >= scene.revealMs
            if (
                !ambient ||
                now - this.lastPaint >= frameInterval(AMBIENT_FPS)
            ) {
                this.lastPaint = now
                this.draw(t)
            }
        } finally {
            if (this.host && this.loopWanted())
                this.raf = requestAnimationFrame(this.tick)
        }
    }

    private onVisibility = () => {
        this.hidden = document.visibilityState === 'hidden'
        this.refresh()
    }

    private onReduced = () => {
        this.reduced = !!this.mql?.matches
        this.refresh()
    }

    private onResize = () => {
        if (this.scene) this.draw(this.timeNow())
    }

    /** The backing store is sized from devicePixelRatio, which a resize never reports: zooming or
     *  moving the window to another display changes it with the box untouched, leaving the old
     *  bitmap stretched (soft). Watch the ratio itself and repaint when it moves. */
    private watchDpr() {
        this.dprMql?.removeEventListener('change', this.onDpr)
        this.dprMql = null
        if (typeof matchMedia !== 'function') return
        this.dprMql = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        this.dprMql.addEventListener('change', this.onDpr)
    }

    private onDpr = () => {
        this.watchDpr()
        if (this.scene) this.draw(this.timeNow())
    }

    private onTheme = () => {
        this.readTokens()
        if (this.scene) this.draw(this.timeNow())
    }

    // ---- tokens + metrics -------------------------------------------------------------------

    private readTokens() {
        const h = this.host
        if (!h || typeof getComputedStyle !== 'function') return
        const cs = getComputedStyle(h)
        this.colors = GLYPH_COLORS.map(name => {
            const v = cs.getPropertyValue(GLYPH_COLOR_VARS[name]).trim()
            return v || 'currentColor'
        })
        const stack = cs.getPropertyValue('--ui-font-stack').trim()
        if (stack) this.fontStack = stack
        const rowH = parseFloat(cs.getPropertyValue('--cell-h'))
        if (Number.isFinite(rowH) && rowH > 0) this.baseCellH = rowH
        this.applyFont(this.scale)
    }

    /** Pin the character advance to the cell width (also disables ligatures, which would fuse
     *  "//" and shear the drawing off its cells). Without letterSpacing, adopt the font's own
     *  measured advance as the cell width instead. */
    private applyFont(scale: number) {
        const ctx = this.ctx as SpacedContext | null
        if (!ctx) return
        ctx.font = `${FONT_PX * scale}px ${this.fontStack}`
        const want = CELL_W * scale
        const supported = typeof ctx.letterSpacing === 'string'
        if (supported) ctx.letterSpacing = '0px'
        const natural = ctx.measureText('0'.repeat(64)).width / 64
        if (supported && natural > 0) {
            ctx.letterSpacing = `${(want - natural).toFixed(4)}px`
            this.cellW = want
        } else {
            this.cellW = natural > 0 ? natural : want
        }
    }

    /** Reconcile canvas + grid with the host's current box. False when the box is unusable. */
    private syncSize(scene: GlyphScene): boolean {
        const host = this.host
        const canvas = this.canvas
        if (!host || !canvas) return false
        if (!this.ctx) this.ctx = canvas.getContext('2d')
        if (!this.ctx) return false
        const r = host.getBoundingClientRect()
        if (!isUsableBox(r.width, r.height)) return false
        const scale = fitScale(
            r.width,
            r.height,
            scene.cols,
            scene.rows,
            CELL_W,
            this.baseCellH,
        )
        this.scale = scale
        this.W = r.width
        this.H = r.height
        this.cellH = this.baseCellH * scale
        this.dpr = clampDprToCanvasArea(
            Math.min(2, window.devicePixelRatio || 1),
            this.W,
            this.H,
        )
        // Assigning width/height clears the canvas AND resets the context state (font,
        // letterSpacing), so only touch them when they change, and re-apply the font after.
        const bw = Math.round(this.W * this.dpr)
        const bh = Math.round(this.H * this.dpr)
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw
            canvas.height = bh
        }
        this.applyFont(scale)
        // +0.05: calc(96 * 6.3px) lays out ~604.797 after 1/64px snapping, which floors to 95.
        this.cols = Math.floor(this.W / this.cellW + 0.05)
        this.rows = Math.floor(this.H / this.cellH + 0.05)
        return true
    }

    // ---- paint ------------------------------------------------------------------------------

    private draw(t: number) {
        const scene = this.scene
        const buf = this.buf
        if (!scene || !buf) return
        if (!this.syncSize(scene)) return
        const ctx = this.ctx
        if (!ctx) return
        try {
            scene.frame(t, buf)
        } catch (e) {
            if (!this.frameErrorLogged) {
                this.frameErrorLogged = true
                console.error('GlyphCanvas frame failed', e)
            }
            return
        }
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
        ctx.clearRect(0, 0, this.W, this.H)
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        const fit = fitScene(this.cols, this.rows, buf.cols, buf.rows)
        for (let row = 0; row < buf.rows; row++) {
            const boxRow = fit.row + row
            if (boxRow < 0 || boxRow >= this.rows) continue
            const y = boxRow * this.cellH + this.cellH / 2
            for (const run of rowRuns(buf, row)) {
                // Clip to the box grid: cells outside it are skipped, never drawn or thrown on.
                const c0 = Math.max(0, fit.col + run.col)
                const c1 = Math.min(
                    this.cols,
                    fit.col + run.col + run.text.length,
                )
                if (c1 <= c0) continue
                const text = run.text.slice(
                    c0 - (fit.col + run.col),
                    c1 - (fit.col + run.col),
                )
                ctx.fillStyle = this.colors[run.color]
                ctx.globalAlpha = run.alpha / 255
                ctx.fillText(text, c0 * this.cellW, y)
            }
        }
        ctx.globalAlpha = 1
    }
}
