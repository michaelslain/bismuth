// Visual spec for <GraphAtmosphere> — the phosphor-bloom layer + depth vignette painted behind
// the graph canvas.
//
// GraphView.stories.tsx's header says this component is "NOT storied standalone... alone it
// would show only a static vignette." That is true of a naive render, but not a fundamental
// limit: GraphAtmosphere takes a `sink: BloomSink` prop (a stable mutable cell, deliberately NOT
// a `renderer` prop — see the file-level comment on GraphAtmosphere.tsx for why) and registers
// its own paint function into `sink.current` on mount. The renderer's ONLY job is calling
// `sink.current?.(field)` each frame with a `DensityField`. A story can do exactly that itself —
// build a real `DensityField` with the REAL production pipeline (`buildBloom` in
// densityField.ts: accumulate -> blur -> normalise, the same function AsciiGraphRenderer feeds
// from live node positions) and push it through the sink by hand. That is not a fabricated
// stand-in for the effect; it is the effect, driven by a fixture instead of a live renderer.
//
// Points are "screen fractions" (accumulate()'s 0..1 x/y), so `sampleGraphData`'s precomputed
// 2D layout (already normalised node positions from the production layout pipeline) is reused
// rather than hand-placing bloom sources.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { onMount } from 'solid-js'
import { GraphAtmosphere, type BloomSink } from './GraphAtmosphere'
import { buildBloom, type BloomPoint } from './densityField'
import { sampleGraphData } from '../ui/_graphFixtures'

const meta = {
    title: 'Graph/GraphAtmosphere',
    component: GraphAtmosphere,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GraphAtmosphere>

export default meta
type Story = StoryObj<typeof meta>

const STAGE_H = '360px'

/** `.graph-area`'s own rule (App.css) the real renderer relies on: `position: relative` sizes
 *  the bloom canvas + vignette's `inset: 0`. Painted `--bg` behind it (App.css's reset does this
 *  via `body`, which Storybook's isolated iframe still has, but the fixed-height stage below is
 *  not `body` itself) so the `mix-blend-mode: screen` bloom has a dark ground to glow against,
 *  exactly like the graph pane it normally sits in. */
function Stage(props: { children: unknown }) {
    return (
        <div
            style={{
                position: 'relative',
                width: '100%',
                height: STAGE_H,
                background: 'var(--bg)',
                overflow: 'hidden',
            }}
        >
            {props.children as never}
        </div>
    )
}

/** Turn a fixture's positioned nodes into BloomPoints in the [0,1) screen-fraction space
 *  `accumulate()` expects. `colored` toggles whether a deterministic subset carries an `rgb` —
 *  standing in for community territory (`buildColorSlots` output in the real renderer) — so
 *  `MonoField` (colored=false) and `TerritoryColoured` (colored=true) actually exercise
 *  `buildBloom`'s two different code paths (mono vs. the four-blur weighted-mean colour path)
 *  instead of silently rendering the same field. */
function pointsFromGraph(spread: number, colored: boolean): BloomPoint[] {
    const graph = sampleGraphData(24)
    const xs = graph.nodes.map(n => n.position2d?.[0] ?? 0)
    const ys = graph.nodes.map(n => n.position2d?.[1] ?? 0)
    const minX = Math.min(...xs),
        maxX = Math.max(...xs)
    const minY = Math.min(...ys),
        maxY = Math.max(...ys)
    const spanX = maxX - minX || 1
    const spanY = maxY - minY || 1
    return graph.nodes
        .filter(n => n.position2d)
        .map((n, i): BloomPoint => {
            const [x, y] = n.position2d as [number, number]
            return {
                // Normalise into 0..1 with a margin so peripheral nodes stay in-bounds, then
                // scale toward/away from centre with `spread` to vary how clustered the field
                // reads between stories.
                x: 0.5 + ((x - minX) / spanX - 0.5) * spread,
                y: 0.5 + ((y - minY) / spanY - 0.5) * spread,
                weight: n.kind === 'self' ? 2.2 : 1,
                rgb:
                    !colored || n.kind !== 'note'
                        ? undefined
                        : i % 3 === 0
                          ? ([120, 200, 190] as const)
                          : i % 3 === 1
                            ? ([200, 150, 220] as const)
                            : undefined,
            }
        })
}

/** Push one real DensityField through the sink right after mount (rAF, so it lands after
 *  GraphAtmosphere's own onMount has registered `sink.current`). */
function PushOnce(props: {
    sink: BloomSink
    spread: number
    colored?: boolean
    radius?: number
}) {
    onMount(() => {
        requestAnimationFrame(() => {
            const field = buildBloom(
                pointsFromGraph(props.spread, props.colored ?? false),
                props.radius,
            )
            props.sink.current?.(field)
        })
    })
    return null
}

/** A live loop that keeps pushing evolving fields — spread breathes in and out — so the canvas
 *  is visibly animated rather than a single static frame, the way it looks while the camera
 *  moves in the real graph. Cleans its own rAF loop up on unmount via onCleanup (implicit:
 *  Solid's render-effect scope for this component owns the mount/cleanup pair below). */
function PushLoop(props: { sink: BloomSink }) {
    onMount(() => {
        let raf = 0
        let cancelled = false
        const start = performance.now()
        const tick = (now: number) => {
            if (cancelled) return
            const t = (now - start) / 1600
            const spread = 0.55 + 0.25 * Math.sin(t)
            const field = buildBloom(pointsFromGraph(spread, true))
            props.sink.current?.(field)
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => {
            cancelled = true
            cancelAnimationFrame(raf)
        }
    })
    return null
}

/** A colourless field — every point omits `rgb`, so `buildBloom` takes its cheaper mono path
 *  and the whole glow paints in one base hue (the themed --accent). This is what an embedded
 *  graph block or a community-less graph looks like (see densityField.ts's file comment). */
export const MonoField: Story = {
    render: () => {
        const sink: BloomSink = {}
        return (
            <Stage>
                <GraphAtmosphere sink={sink} mode="2nd" />
                <PushOnce sink={sink} spread={0.7} />
            </Stage>
        )
    },
}

/** A field with two community hues (see `pointsFromGraph`'s deterministic rgb split) — the
 *  territory-tinted case: brightness still comes from density alone, only the hue varies. */
export const TerritoryColoured: Story = {
    render: () => {
        const sink: BloomSink = {}
        return (
            <Stage>
                <GraphAtmosphere sink={sink} mode="2nd" />
                <PushOnce sink={sink} spread={0.7} colored />
            </Stage>
        )
    },
}

/** Nodes pulled tight toward the centre (`spread` near 0) — a dense, small cluster instead of a
 *  field spread across the whole pane, exercising the v^4 curve's "only genuinely dense regions
 *  light up" crush at the opposite extreme from `Diffuse`. */
export const TightCluster: Story = {
    render: () => {
        const sink: BloomSink = {}
        return (
            <Stage>
                <GraphAtmosphere sink={sink} mode="2nd" />
                <PushOnce sink={sink} spread={0.15} radius={10} />
            </Stage>
        )
    },
}

/** Nodes spread to the pane's edges — the low-density-everywhere case, closer to what a large,
 *  zoomed-out vault's field looks like before any cluster dominates. */
export const Diffuse: Story = {
    render: () => {
        const sink: BloomSink = {}
        return (
            <Stage>
                <GraphAtmosphere sink={sink} mode="2nd" />
                <PushOnce sink={sink} spread={1.1} />
            </Stage>
        )
    },
}

/** No field ever pushed — `sink.current` is registered but never called. This is what the
 *  component looks like the instant it mounts, before the renderer's first frame: just the
 *  depth vignette, transparent bloom canvas. Confirms the vignette alone (no bloom) is not
 *  itself a broken render. */
export const VignetteOnly: Story = {
    render: () => {
        const sink: BloomSink = {}
        return (
            <Stage>
                <GraphAtmosphere sink={sink} mode="2nd" />
            </Stage>
        )
    },
}

/** Continuously re-pushed fields (breathing spread) — proves the paint path handles repeated
 *  frames over time, not just a single push, matching how the real renderer drives it every
 *  animation frame while the graph is visible. */
export const Live: Story = {
    render: () => {
        const sink: BloomSink = {}
        return (
            <Stage>
                <GraphAtmosphere sink={sink} mode="2nd" />
                <PushLoop sink={sink} />
            </Stage>
        )
    },
}
