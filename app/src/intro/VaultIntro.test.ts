// app/src/intro/VaultIntro.test.ts
//
// Smoke cover for the first-run intro's graph. This is the FIRST screen a new user ever sees, it
// had no test of any kind, and until the renderer merge it had never executed a line of the ASCII
// renderer — so the failure mode this guards against is "the intro shows a blank rectangle and
// nobody finds out for months".
//
// WHAT THIS DRIVES, AND WHY IT ISN'T A COMPONENT MOUNT. `VaultIntro` is a Solid component and Solid
// components cannot be rendered under `bun test` in this repo: bun resolves `solid-js/web` to its
// SERVER build, so `render()` throws "Client-only API called on the server side". (That is why
// there is not one `.test.tsx` in the tree.) So the two things `IntroGraph` actually owns are
// exported — `applyGraphConfig` and the two baked clouds — from a sibling plain-`.ts` module,
// `./vaultIntroGraph` (NOT from `./VaultIntro` itself: a `.tsx` file cannot be imported under `bun
// test` at all in this repo — see that module's header comment for the full root cause, confirmed
// against Task 26's identical fix for `app/src/graph/embeddedGraphRender.ts`). This file replays
// `IntroGraph`'s own onMount sequence against a real AsciiGraphRenderer, in order:
//     mount → render → applyGraphConfig → setVisible
// Get that order or those arguments wrong and the intro is blank; everything else in the component
// is slide chrome.
//
// TEST ISOLATION (see graph/AsciiGraphRenderer.test.ts for the full reasoning): Bun loads every
// `bun test app/src` module into ONE process, so the DOM globals go in beforeAll (not at module top
// level) and the two patched prototypes are restored in afterAll.
import { GlobalWindow } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { AsciiGraphRenderer } from '../graph/AsciiGraphRenderer'
import type { GraphRenderer } from '../graph/graphRenderer'
import { applyGraphConfig, BIG_GRAPH } from './vaultIntroGraph'
import { THEME_NAMES, type ThemeName } from '../themes'
import { NODE_GLYPHS } from '../graph/asciiGrid'
import type { GraphData } from '../../../core/src/graph'

const DOM_GLOBALS = [
    'document',
    'window',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLDivElement',
    'HTMLCanvasElement',
    'Text',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'PointerEvent',
    'WheelEvent',
    'KeyboardEvent',
    'getComputedStyle',
    'DOMRect',
]
const installed: string[] = []
const saved: Record<string, unknown> = {}
const restore: [Record<string, unknown>, string, unknown][] = []

// The graph is drawn inside the window's art box (1086px wide, 432px tall: the window is 180 cells
// wide less two --sp-7 paddings, the box 24 rows tall).
const BOX = { width: 1086, height: 432 }

interface FakeCtx {
    fills: { text: string; x: number; y: number }[]
    strokes: number
    font: string
    letterSpacing: string
}
function makeCtx(): FakeCtx {
    let font = '11.5px monospace'
    const ctx = {
        fills: [] as { text: string; x: number; y: number }[],
        strokes: 0,
        get font() {
            return font
        },
        set font(v: string) {
            font = v
        },
        letterSpacing: '0px',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        textBaseline: '',
        textAlign: '',
        setTransform() {},
        clearRect() {},
        fillRect() {},
        fillText(t: string, x: number, y: number) {
            ctx.fills.push({ text: t, x, y })
        },
        measureText(s: string) {
            const px = parseFloat(
                (font.match(/^([\d.]+)px/) ?? ['', '11.5'])[1],
            )
            const ls = parseFloat(ctx.letterSpacing) || 0
            return { width: s.length * (px * 0.6 + ls) }
        },
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {
            ctx.strokes++
        },
    }
    return ctx as unknown as FakeCtx
}

let ctx: FakeCtx
let rafQueue: FrameRequestCallback[] = []

beforeAll(() => {
    const win = new GlobalWindow()
    for (const key of DOM_GLOBALS) {
        if (!(key in globalThis) && key in win) {
            ;(globalThis as Record<string, unknown>)[key] = (
                win as unknown as Record<string, unknown>
            )[key]
            installed.push(key)
        }
    }
    if (!('window' in globalThis)) {
        ;(globalThis as Record<string, unknown>).window = win
        installed.push('window')
    }

    ctx = makeCtx()
    const canvasProto = (
        globalThis as unknown as {
            HTMLCanvasElement: { prototype: Record<string, unknown> }
        }
    ).HTMLCanvasElement.prototype
    restore.push([canvasProto, 'getContext', canvasProto.getContext])
    canvasProto.getContext = () => ctx
    const elProto = Element.prototype as unknown as Record<string, unknown>
    restore.push([
        elProto,
        'getBoundingClientRect',
        elProto.getBoundingClientRect,
    ])
    elProto.getBoundingClientRect = function () {
        return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: BOX.width,
            bottom: BOX.height,
            ...BOX,
            toJSON: () => ({}),
        } as DOMRect
    }
    for (const key of [
        'ResizeObserver',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ]) {
        saved[key] = (globalThis as Record<string, unknown>)[key]
    }
    ;(globalThis as Record<string, unknown>).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        rafQueue.push(cb)
        return rafQueue.length
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
})

afterAll(() => {
    for (const [obj, key, value] of restore) obj[key] = value
    for (const key of Object.keys(saved))
        (globalThis as Record<string, unknown>)[key] = saved[key]
    for (const key of installed)
        delete (globalThis as Record<string, unknown>)[key]
})

function frame(t = 16) {
    const q = rafQueue
    rafQueue = []
    for (const cb of q) cb(t)
}

interface Mounted {
    r: GraphRenderer
    viewport: HTMLElement
    painted: number[]
}

/** IntroGraph's onMount, verbatim, against a real renderer. */
function mountIntroGraph(
    graph: GraphData,
    theme: ThemeName = 'ink',
    opts: { active?: boolean } = {},
): Mounted {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const r: GraphRenderer = new AsciiGraphRenderer()
    const painted: number[] = []
    r.mount(host, () => {})
    r.setPaintCallback(n => painted.push(n))
    r.render(graph)
    applyGraphConfig(r, theme)
    r.setVisible(opts.active ?? true)
    ctx.fills.length = 0
    ctx.strokes = 0
    painted.length = 0
    frame()
    return {
        r,
        viewport: host.firstElementChild as HTMLElement,
        painted,
    }
}

describe('VaultIntro — the graph slide on the unified renderer', () => {
    it('the cloud is the fixture the slide describes', () => {
        expect(BIG_GRAPH.nodes.length).toBe(337)
        // the renderer only auto-spins a 3D graph of at most 350 nodes; the intro's must turn
        expect(BIG_GRAPH.nodes.length).toBeLessThanOrEqual(350)
        // Positions are BAKED (no force settle, no auto-fit race) — every node must carry one.
        expect(BIG_GRAPH.nodes.every(n => n.position && n.position2d)).toBe(true)
    })

    it("paints the three-brains slide's whole-vault cloud inside the art box", () => {
        const { r, painted } = mountIntroGraph(BIG_GRAPH)
        // 336 notes in six topic blossoms: many share a cell, so the painted count is a large fraction of
        // the field rather than the node count. The number that matters is that it is NOT near-zero —
        // a mis-framed cloud empties the grid.
        expect(painted.at(-1)).toBeGreaterThan(80)
        expect(ctx.strokes).toBeGreaterThan(0) // the link edges too
        r.destroy()
    })

    it('frames the cloud INSIDE the box — it neither collapses nor spills', () => {
        const { r } = mountIntroGraph(BIG_GRAPH)
        const p = r as unknown as { nodes: { sx: number; sy: number }[] }
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity
        for (const nv of p.nodes) {
            minX = Math.min(minX, nv.sx)
            maxX = Math.max(maxX, nv.sx)
            minY = Math.min(minY, nv.sy)
            maxY = Math.max(maxY, nv.sy)
        }
        expect(minX).toBeGreaterThanOrEqual(0)
        expect(maxX).toBeLessThanOrEqual(BOX.width)
        expect(minY).toBeGreaterThanOrEqual(0)
        expect(maxY).toBeLessThanOrEqual(BOX.height)
        expect(maxY - minY).toBeGreaterThan(BOX.height * 0.3)
        expect(maxY - minY).toBeLessThanOrEqual(BOX.height * 1.05)
        r.destroy()
    })

    it("shows NO names and no cluster machinery — the intro's nodes are deliberately anonymous", () => {
        // `showGraphLabels: false`. The cloud does carry a community per node (it is what gives the
        // palette five colours), so "no communities" is NOT what keeps cluster names off the field —
        // the label gate is. Worth pinning: drop that gate and the first thing a new user sees is a
        // screen captioned CLUSTER 0 … CLUSTER 4.
        expect(BIG_GRAPH.nodes.some(n => n.community != null)).toBe(true)
        const { r } = mountIntroGraph(BIG_GRAPH)
        expect(ctx.fills.length).toBeGreaterThan(0)
        // Every fill is a run of degree-ramp glyphs — no letters of any kind.
        const ramp = new Set<string>([...NODE_GLYPHS, ' '])
        const words = ctx.fills.filter(f => [...f.text].some(c => !ramp.has(c)))
        expect(words).toEqual([])
        r.destroy()
    })

    it('keeps the window ground showing through (transparent: true)', () => {
        // The graph sits on the window's own --editor ground; an opaque --graph-bg would paint a
        // differently coloured rectangle inside the art box.
        const { r, viewport } = mountIntroGraph(BIG_GRAPH)
        expect(viewport.style.background).toBe('transparent')
        r.destroy()
    })

    it('re-themes live without blanking — every theme in the picker', () => {
        // The theme card click path: applyGraphConfig again on the SAME live renderer. setConfig
        // re-reads tokens, re-measures and re-fits, and a bug there empties the field silently.
        const { r, painted } = mountIntroGraph(BIG_GRAPH)
        for (const name of THEME_NAMES) {
            applyGraphConfig(r, name)
            frame(1000)
            expect(painted.at(-1)).toBeGreaterThan(80)
        }
        r.destroy()
    })

    it('an inactive instance is paused, and resumes when it becomes active', () => {
        const { r, painted } = mountIntroGraph(BIG_GRAPH, 'ink', {
            active: false,
        })
        painted.length = 0
        frame(1000)
        frame(2000)
        expect(painted).toEqual([])
        r.setVisible(true)
        frame(3000)
        expect(painted.at(-1)).toBeGreaterThan(80)
        r.destroy()
    })
})
