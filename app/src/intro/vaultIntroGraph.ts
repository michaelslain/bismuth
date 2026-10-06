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
// force-settle, no auto-fit race). It has to read as a designed object, not noise: six topic
// "blossoms" of equal size sit on the six points of an octahedron — four on a ring around the spin
// axis, one above, one below — so the shape is balanced from every angle as it turns. "You" sit at
// the centre with a spoke to every topic's hub, each topic links to its neighbours, and inside a
// topic notes grow by preferential attachment (a new note links to a well-linked one more often),
// so each hub bursts into a star with branches. A note is kept inside its topic's sphere, so every
// blossom is round and the gaps between them stay clean.
//
// The renderer's 3D fit scales the FARTHEST node from the origin to the box edge, so the whole
// cloud is normalised to that radius: nothing strays past the blossoms' rims.
function growBlossoms(
    perTopic: number,
    radius: number,
    seed: number,
): GraphData {
    let s = seed
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const unit = (): [number, number, number] => {
        const z = 2 * rnd() - 1
        const a = rnd() * Math.PI * 2
        const r = Math.sqrt(1 - z * z)
        return [r * Math.cos(a), r * Math.sin(a), z]
    }
    type V3 = [number, number, number]
    // The octahedron: a ring of four around the vertical (spin) axis, then top and bottom. Ring
    // topics take graph colours 0-3; the two poles share colour 4.
    const SHELL = 0.62
    const BLOSSOM = 0.24
    const centres: V3[] = [
        [SHELL, 0, 0],
        [0, 0, SHELL],
        [-SHELL, 0, 0],
        [0, 0, -SHELL],
        [0, SHELL, 0],
        [0, -SHELL, 0],
    ]
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
    const hubs: string[] = []
    centres.forEach((centre, c) => {
        const own: { id: string; p: V3; deg: number }[] = []
        const add = (p: V3) => {
            const id = `n${c}-${own.length}`
            own.push({ id, p, deg: 0 })
            nodes.push({
                id,
                label: '',
                kind: 'note',
                community: Math.min(c, 4),
                position: p,
                position2d: [p[0], p[1]],
            })
            return own[own.length - 1]!
        }
        const hub = add(centre)
        hubs.push(hub.id)
        for (let j = 1; j < perTopic; j++) {
            // Preferential attachment: a parent is picked with probability ~ (degree + 1).
            let total = 0
            for (const g of own) total += g.deg + 1
            let pick = rnd() * total
            let parent = own[0]!
            for (const g of own) {
                pick -= g.deg + 1
                if (pick <= 0) {
                    parent = g
                    break
                }
            }
            const [ux, uy, uz] = unit()
            const len = BLOSSOM * (0.18 + 0.22 * rnd())
            let p: V3 = [
                parent.p[0] + ux * len,
                parent.p[1] + uy * len,
                parent.p[2] + uz * len,
            ]
            // Keep the note inside its blossom: past the rim, it is pulled back onto it.
            const d: V3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]
            const r = Math.hypot(...d)
            if (r > BLOSSOM) {
                const k = (BLOSSOM * (0.85 + 0.15 * rnd())) / r
                p = [
                    centre[0] + d[0] * k,
                    centre[1] + d[1] * k,
                    centre[2] + d[2] * k,
                ]
            }
            const node = add(p)
            edges.push({ from: parent.id, to: node.id, kind: 'link' })
            parent.deg++
            node.deg++
        }
    })
    // Spokes from "you" to every hub; the ring's neighbours link to each other; the poles link to
    // every ring topic.
    for (const h of hubs) edges.push({ from: 'you', to: h, kind: 'link' })
    for (let c = 0; c < 4; c++) {
        edges.push({ from: hubs[c]!, to: hubs[(c + 1) % 4]!, kind: 'link' })
        edges.push({ from: hubs[4]!, to: hubs[c]!, kind: 'link' })
        edges.push({ from: hubs[5]!, to: hubs[c]!, kind: 'link' })
    }
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

// The palette slide's backdrop and the three-brains slide's hero: one graph, six topics of 56 notes.
// 337 nodes in all, deliberately: AsciiGraphRenderer only auto-spins a 3D graph of at most 350
// nodes (its tick() spin guard), and the intro's graph has to turn on both slides.
// Exported so the headless smoke test drives the renderer with the REAL first-run fixture.
export const BIG_GRAPH = growBlossoms(56, 760, 987654321)

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
