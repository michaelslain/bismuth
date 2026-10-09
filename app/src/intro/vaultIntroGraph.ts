/* app/src/intro/vaultIntroGraph.ts — the intro's pure, JSX-free graph pieces.
   Extracted out of VaultIntro.tsx (a Solid component file) so they can be imported by
   VaultIntro.test.ts under `bun test`.

   WHY THIS FILE EXISTS: `bun test` must pick a JSX transform for a `.tsx` file the moment it
   loads it, even for exports that contain zero JSX — the transform decision is file-wide, not
   export-wide. `app/tsconfig.json` sets `jsx: "preserve"` + `jsxImportSource: "solid-js"`, which
   is correct for Vite (whose vite-plugin-solid runs babel-preset-solid, compiling JSX straight to
   DOM-creation calls, not to calls into a runtime module). `"preserve"` is not an executable JSX
   mode Bun's own transpiler supports, so under `bun test` it falls back to Bun's default — the
   classic React automatic runtime — and tries to import `react/jsx-dev-runtime`, which isn't
   installed. Retargeting the automatic runtime at `solid-js/jsx-dev-runtime` doesn't work either:
   that export exists in solid-js's package.json only for TypeScript's type-checker, and at
   runtime re-exports `dist/solid.js`, which has no `jsx`/`jsxs`/`jsxDEV` functions. There is no
   tsconfig/bunfig-only fix (confirmed in Task 26, `EmbeddedGraph.tsx` / `embeddedGraphRender.ts`,
   the byte-identical defect) — the fix is to keep anything a test needs to import out of any file
   that contains JSX.

   `IntroGraph.tsx` imports applyGraphConfig back from here and VaultIntro.tsx imports BIG_GRAPH. */
import type { GraphRenderer } from '../graph/graphRenderer'
import { paletteToInts, hexToInt } from '../themeColors'
import type { GraphData } from '../../../core/src/graph'
import { THEMES, type ThemeName } from '../themes'
import { DEFAULT_ACCENT_PALETTE } from '../settings'

// Grow the intro's graph with BAKED positions (the renderer draws them directly — no cold
// force-settle, no auto-fit race). It has to read as a designed object, not noise: a constellation
// of nine topics of falling size, spread evenly over a shell by a Fibonacci spiral (so it is
// balanced from every angle as it turns) at slightly varied depths. Inside a topic, notes grow by
// preferential attachment (a new note links to a well-linked one more often) and each branch leans
// AWAY from the hub, so a topic bursts into a starburst of filaments rather than a round clump; a
// note is kept inside its topic's sphere, sized by the topic's note count. Each hub links to its two
// nearest topics, and a few bridge notes sit between linked topics with a link into each, so the
// shell reads as one web. "You" sit at the centre with a spoke to every hub.
//
// The renderer's 3D fit scales the FARTHEST node from the origin to the box edge, so the whole
// cloud is normalised to that radius: nothing strays past the outermost rim.
function growConstellation(
    sizes: number[],
    bridgesPerLink: number,
    radius: number,
    seed: number,
): GraphData {
    let s = seed
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    type V3 = [number, number, number]
    const unit = (): V3 => {
        const z = 2 * rnd() - 1
        const a = rnd() * Math.PI * 2
        const r = Math.sqrt(1 - z * z)
        return [r * Math.cos(a), r * Math.sin(a), z]
    }
    const norm = (v: V3): V3 => {
        const l = Math.hypot(...v) || 1
        return [v[0] / l, v[1] / l, v[2] / l]
    }
    const nodes: GraphData['nodes'] = [
        {
            id: 'you',
            label: '',
            kind: 'self',
            position: [0, 0, 0],
            position2d: [0, 0],
        },
    ]
    const edges: GraphData['edges'] = []
    type Note = { id: string; p: V3; deg: number }
    const add = (id: string, p: V3, community: number): Note => {
        nodes.push({
            id,
            label: '',
            kind: 'note',
            community,
            position: p,
            position2d: [p[0], p[1]],
        })
        return { id, p, deg: 0 }
    }
    const link = (a: Note, b: Note) => {
        edges.push({ from: a.id, to: b.id, kind: 'link' })
        a.deg++
        b.deg++
    }
    // Topic centres: a Fibonacci spiral over the sphere, Y the spin axis.
    const GOLDEN = Math.PI * (3 - Math.sqrt(5))
    const topics = sizes.map((size, c) => {
        const y = 1 - (2 * (c + 0.5)) / sizes.length
        const ring = Math.sqrt(1 - y * y)
        const a = c * GOLDEN
        const shell = 0.62 + 0.1 * rnd()
        const centre: V3 = [
            Math.cos(a) * ring * shell,
            y * shell,
            Math.sin(a) * ring * shell,
        ]
        return { centre, rim: 0.06 + 0.03 * Math.sqrt(size), notes: [] as Note[] }
    })
    // Balance the mass on "you": shift every centre by the size-weighted mean, so the cloud turns
    // about its own middle instead of swinging one heavy side round.
    const mass = sizes.reduce((a, b) => a + b, 0)
    for (let i = 0; i < 3; i++) {
        let m = 0
        topics.forEach((t, c) => (m += t.centre[i]! * sizes[c]!))
        for (const t of topics) t.centre[i]! -= m / mass
    }
    topics.forEach((t, c) => {
        const community = c % 5
        t.notes.push(add(`n${c}-0`, t.centre, community))
        for (let j = 1; j < sizes[c]!; j++) {
            // Preferential attachment: a parent is picked with probability ~ (degree + 1).
            let total = 0
            for (const g of t.notes) total += g.deg + 1
            let pick = rnd() * total
            let parent = t.notes[0]!
            for (const g of t.notes) {
                pick -= g.deg + 1
                if (pick <= 0) {
                    parent = g
                    break
                }
            }
            // Lean the branch away from the hub, so filaments radiate instead of clumping.
            const out: V3 = [
                parent.p[0] - t.centre[0],
                parent.p[1] - t.centre[1],
                parent.p[2] - t.centre[2],
            ]
            const lean = Math.hypot(...out) > 1e-6 ? 1.1 : 0
            const o = norm(out)
            const u = unit()
            const dir = norm([
                o[0] * lean + u[0],
                o[1] * lean + u[1],
                o[2] * lean + u[2],
            ])
            const len = t.rim * (0.3 + 0.25 * rnd())
            let p: V3 = [
                parent.p[0] + dir[0] * len,
                parent.p[1] + dir[1] * len,
                parent.p[2] + dir[2] * len,
            ]
            // Keep the note inside its topic: past the rim, it is pulled back onto it.
            const d: V3 = [p[0] - t.centre[0], p[1] - t.centre[1], p[2] - t.centre[2]]
            const r = Math.hypot(...d)
            if (r > t.rim) {
                const k = (t.rim * (0.88 + 0.12 * rnd())) / r
                p = [
                    t.centre[0] + d[0] * k,
                    t.centre[1] + d[1] * k,
                    t.centre[2] + d[2] * k,
                ]
            }
            const note = add(`n${c}-${j}`, p, community)
            t.notes.push(note)
            link(parent, note)
        }
    })
    // The web: every hub to its two nearest topics, each pair once.
    const pairs = new Set<string>()
    topics.forEach((t, c) => {
        const near = topics
            .map((o, i) => ({
                i,
                d: Math.hypot(
                    o.centre[0] - t.centre[0],
                    o.centre[1] - t.centre[1],
                    o.centre[2] - t.centre[2],
                ),
            }))
            .filter(x => x.i !== c)
            .sort((a, b) => a.d - b.d)
            .slice(0, 2)
        for (const { i } of near) pairs.add(c < i ? `${c}:${i}` : `${i}:${c}`)
    })
    let bridge = 0
    for (const key of pairs) {
        const [a, b] = key.split(':').map(Number) as [number, number]
        const ta = topics[a]!
        const tb = topics[b]!
        link(ta.notes[0]!, tb.notes[0]!)
        // Bridge notes: one note from each side, joined through a note between them.
        for (let k = 0; k < bridgesPerLink; k++) {
            const na = ta.notes[1 + Math.floor(rnd() * (ta.notes.length - 1))]!
            const nb = tb.notes[1 + Math.floor(rnd() * (tb.notes.length - 1))]!
            const f = 0.35 + 0.3 * rnd()
            const j = unit()
            const p: V3 = [
                na.p[0] + (nb.p[0] - na.p[0]) * f + j[0] * 0.03,
                na.p[1] + (nb.p[1] - na.p[1]) * f + j[1] * 0.03,
                na.p[2] + (nb.p[2] - na.p[2]) * f + j[2] * 0.03,
            ]
            const note = add(`b${bridge++}`, p, (f < 0.5 ? a : b) % 5)
            link(na, note)
            link(note, nb)
        }
    }
    for (const t of topics)
        edges.push({ from: 'you', to: t.notes[0]!.id, kind: 'link' })
    // Normalise so the farthest note sits exactly at `radius`.
    let far = 1e-6
    for (const n of nodes)
        far = Math.max(far, Math.hypot(...(n.position as V3)))
    const k = radius / far
    for (const n of nodes) {
        const [x, y, z] = n.position as V3
        n.position = [x * k, y * k, z * k]
        n.position2d = [x * k, y * k]
    }
    return { nodes, edges }
}

// The palette slide's backdrop and the three-brains slide's hero: one graph, nine topics from 44
// notes down to 10, plus the bridge notes between them. Under 350 nodes, deliberately:
// AsciiGraphRenderer only auto-spins a 3D graph of at most 350 nodes (its tick() spin guard), and
// the intro's graph has to turn on both slides.
// Exported so the headless smoke test drives the renderer with the REAL first-run fixture.
export const BIG_GRAPH = growConstellation(
    [44, 36, 30, 26, 22, 18, 15, 12, 10],
    3,
    760,
    987654321,
)

// Push the chosen theme's colors into a renderer. Used by IntroGraph. Typed to the
// SEAM, not to a concrete renderer class — the intro is a consumer of GraphRenderer like any other.
// Exported for the headless smoke test (VaultIntro.test.ts), which drives a real renderer with this
// exact config; the component itself cannot be mounted under `bun test` (bun resolves solid-js/web
// to its SERVER build).
//
// NOTE ON THE COLOUR FIELDS BELOW: the surviving renderer paints from the theme's CSS custom
// properties (--graph-0..4, --graph-edge, --fg, --graph-bg) and IGNORES palette/edgeColor/
// edgeOpacity/backgroundColor/labelTextColor/labelBgColor/selfColor. They are kept because
// GraphConfig still requires them, and because the intro sets the very same tokens on
// documentElement (setCssVars, in VaultIntro.tsx) one slide earlier — so the field recolours on a
// theme pick through that path instead. The one visual consequence worth naming: node colour now
// comes from --graph-0..4 (the theme's own graph ramp) rather than accentPalette, which is what
// the palette slide is advertising anyway.
export function applyGraphConfig(renderer: GraphRenderer, name: ThemeName) {
    const ap = THEMES[name]
    const palette = ap.accentPalette?.length
        ? ap.accentPalette
        : DEFAULT_ACCENT_PALETTE
    renderer.setConfig({
        spin: true,
        spinSpeed: 0.0016,
        palette: paletteToInts(palette),
        viewMode: '3d',
        showGraphLabels: false,
        graphLabelHubCount: 0,
        edgeColor: hexToInt(ap.neutral, 0xaeb4c2),
        edgeOpacity: ap.isLight ? 0.22 : 0.34,
        // Transparent ground so the intro window's own ground shows THROUGH the graph. Load-bearing,
        // not vestigial: the field's viewport otherwise paints an opaque --graph-bg, and the graph
        // fades and moves between the palette and three-brains slides, so an opaque ground would be
        // a --graph-bg slab fading over the window — visible in three of the four themes (riso's pair
        // is the widest gap). See AsciiGraphRenderer.applyGround().
        transparent: true,
        backgroundColor: hexToInt(ap.background, 0x14151b),
        labelTextColor: 'rgba(0,0,0,0)',
        labelBgColor: 'rgba(0,0,0,0)',
        selfColor: hexToInt(ap.foreground, 0xffffff),
    })
}
