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

   `VaultIntro.tsx` imports all three names back from here unchanged; the component itself is
   otherwise untouched. */
import type { GraphRenderer } from '../graph/graphRenderer'
import { paletteToInts, hexToInt } from '../themeColors'
import type { GraphData } from '../../../core/src/graph'
import { THEMES, type ThemeName } from '../themes'
import { DEFAULT_ACCENT_PALETTE } from '../settings'

// Build a point-cloud graph with BAKED positions (a seeded random sphere). Baking positions
// means the renderer draws the layout directly — no cold force-settle, no auto-fit race — so
// it frames any node count instantly and reliably. The "you" hub sits at the center.
function makeCloud(n: number, radius: number, seed: number): GraphData {
    let s = seed
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const nodes: GraphData['nodes'] = [
        {
            id: 'you',
            label: '',
            kind: 'self',
            position: [0, 0, 0],
            position2d: [0, 0],
        },
    ]
    for (let i = 0; i < n; i++) {
        const r = radius * Math.cbrt(rnd())
        const theta = rnd() * Math.PI * 2
        const phi = Math.acos(2 * rnd() - 1)
        const x = r * Math.sin(phi) * Math.cos(theta)
        const y = r * Math.sin(phi) * Math.sin(theta)
        const z = r * Math.cos(phi)
        nodes.push({
            id: `n${i}`,
            label: '',
            kind: 'note',
            community: i % 5,
            position: [x, y, z] as [number, number, number],
            position2d: [x, y] as [number, number],
        })
    }
    const edges: GraphData['edges'] = []
    for (let i = 0; i < n; i++) {
        if (i % 6 === 0) edges.push({ from: 'you', to: `n${i}`, kind: 'link' })
        if (i >= 7) edges.push({ from: `n${i - 7}`, to: `n${i}`, kind: 'link' })
    }
    return { nodes, edges }
}

// Theme slide: a small starter cloud (just enough to show the palette). Three-brains slide:
// a whole vault's worth of notes (~the size of a real Bismuth vault) — the explosion.
// Exported so the headless smoke test drives the renderer with the REAL first-run fixtures rather
// than a stand-in (they differ in the ways that matter: node count either side of the 350-node idle
// spin cut-off, and a baked layout with no settle).
export const SMALL_GRAPH = makeCloud(54, 300, 1234567)
export const BIG_GRAPH = makeCloud(1874, 760, 987654321)

// Push the chosen theme's colors into a renderer. Shared by both IntroGraph instances. Typed to the
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
        // Transparent ground so the page's own --bg shows THROUGH the graph. Load-bearing, not
        // vestigial: the field's viewport otherwise paints an opaque --graph-bg, and the two IntroGraph
        // layers CROSS-FADE (opacity 0↔1), so an opaque ground would fade the whole page background
        // between --bg and --graph-bg on every slide change — visible in three of the four themes
        // (riso's pair is the widest gap). See AsciiGraphRenderer.applyGround().
        transparent: true,
        backgroundColor: hexToInt(ap.background, 0x14151b),
        labelTextColor: 'rgba(0,0,0,0)',
        labelBgColor: 'rgba(0,0,0,0)',
        selfColor: hexToInt(ap.foreground, 0xffffff),
    })
}
