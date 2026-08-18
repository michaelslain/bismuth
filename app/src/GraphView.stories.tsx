// ⚠ A BLANK CANVAS HERE IS USUALLY NOT A BUG. GraphView gates its renderer on
// `props.visible !== false && !docHidden()` (GraphView.tsx:342,378). Any browser-automation tab
// that is not foregrounded reports `document.visibilityState === "hidden"`, so the rAF loop is
// paused and the canvas samples as 0% inked — indistinguishable from a broken renderer. This is
// documented in bench/visual.ts, which exists precisely because of it and launches its own Chrome
// with --disable-*background* flags to get a live loop unattended. Verify this story either in a
// real foregrounded browser or via bench/visual.ts; do not "fix" the story in response to a blank
// automated screenshot.
// Visual spec for <GraphView> — the ASCII knowledge-graph canvas. It takes `graph: GraphData`
// as a plain prop and makes NO api./fetch calls of its own; every position comes pre-computed
// from sampleGraphData() (app/src/ui/_graphFixtures.ts), which runs the SAME pure layout the
// backend uses (core/src/layout.ts's computeLayout) — client-side, DOM-free, and already the
// production path for app/src/graph/EmbeddedGraph.tsx's ```graph blocks. Server-side layout in
// the real app is a perf choice for a large vault, not something GraphView itself requires.
//
// GraphAtmosphere (the phosphor-bloom layer) is NOT storied standalone — it paints from a live
// per-frame BloomSink the renderer feeds it, so alone it would show only a static vignette. It
// mounts unconditionally inside GraphView itself, so every story below exercises it as a real
// layer for free.
//
// `visible` pauses the renderer's rAF loop (in the app it stops a hidden sidebar slot from
// burning frames while the main pane shows the graph). Storybook only ever mounts one story's
// canvas at a time, so there's no hidden instance to pause here — left at its default (visible)
// on every story below, called out explicitly so a future story that stacks more than one
// <GraphView> in a single render knows to set it false on whichever isn't the one being shown.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { GraphView } from './GraphView'
import { sampleGraphData } from './ui/_graphFixtures'

const meta = {
    title: 'Graph/GraphView',
    component: GraphView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GraphView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

// Fixed px, not vh: the Storybook preview iframe is short with the Controls panel open (see
// Calendar/MonthView.stories.tsx's own note on this), and `.graph-root` fills its parent's
// height (App.css `.graph-root { height: 100% }`).
const STORY_H = '640px'

/** The full-pane 2D field: a self node, 8 wikilink-chained notes, a few tags fanning off them —
 *  real coordinates from computeLayout, not hand-placed. `fill` is how the real app always
 *  renders GraphView (App.tsx's one call site never omits it); the 1:1-square fallback only
 *  the `mini` story below exists for cases that don't pass it. */
export const Default: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <GraphView
                graph={sampleGraphData(8)}
                onOpen={noop}
                mode="2nd"
                setMode={noop}
                active={null}
                fill
            />
        </div>
    ),
}

/** A 60-note graph — same fixture, much larger — to see the field's respacing, hub labelling,
 *  and cluster masses hold up past the everyday small-vault case. `active` points at one of the
 *  generated note ids so the active-file highlight has something real to draw. */
export const LargerGraph: Story = {
    render: () => {
        const graph = sampleGraphData(60)
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <GraphView
                    graph={graph}
                    onOpen={noop}
                    mode="2nd"
                    setMode={noop}
                    active={graph.nodes[1]?.id ?? null}
                    fill
                />
            </div>
        )
    },
}

/**
 * The cramped sidebar slot: `mini` swaps the text-segmented mode switcher for bare icon
 * buttons and adds the bottom-right LOCAL toggle; sized to the sidebar's own default height
 * (App.css `--sidebar-graph-height, 305px`) rather than the full pane. Mode is "local" — a
 * lens over the open note's neighbourhood, not a sibling of 2nd/3rd/both — which also makes it
 * the one GraphMode this gallery can show without faking the daemon setting: GraphView's own
 * effect resets 3rd/both/daemon back to "2nd" while `settings.daemon.enabled` is off (the
 * Storybook default, seeded from the schema DEFAULTS), but "local" isn't gated on that switch.
 * `communitySource` stands in for the full un-mode-filtered vault graph GraphView otherwise
 * reads community/communityPath from for the local layout's community-aware settle (see
 * localLayoutInput.ts) — the same fixture graph serves both roles here.
 */
export const MiniLocal: Story = {
    render: () => {
        const graph = sampleGraphData(8)
        return (
            <div style={{ height: '305px', width: '266px' }}>
                <GraphView
                    graph={graph}
                    communitySource={graph}
                    onOpen={noop}
                    mode="local"
                    setMode={noop}
                    active={graph.nodes[1]?.id ?? null}
                    fill
                    mini
                />
            </div>
        )
    },
}
