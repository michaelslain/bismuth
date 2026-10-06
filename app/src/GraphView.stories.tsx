// ⚠ A BLANK CANVAS HERE IS USUALLY NOT A BUG. GraphView gates its renderer on
// `props.visible !== false && !docHidden()` (GraphView.tsx:342,378). Any browser-automation tab
// that is not foregrounded reports `document.visibilityState === "hidden"`, so the rAF loop is
// paused and the canvas samples as 0% inked — indistinguishable from a broken renderer. This is
// documented in bench/appShots.ts, which exists precisely because of it and launches its own Chrome
// with --disable-*background* flags to get a live loop unattended. Verify this story either in a
// real foregrounded browser or via bench/appShots.ts; do not "fix" the story in response to a blank
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
// mounts inside GraphView while the `graph.gradient` setting is on. That setting is OFF by default,
// so most stories below render the flat ground the product ships; the Clustered/Gradient stories
// turn it on to exercise the atmosphere as a real layer.
//
// `visible` pauses the renderer's rAF loop (in the app it stops a hidden sidebar slot from
// burning frames while the main pane shows the graph). Storybook only ever mounts one story's
// canvas at a time, so there's no hidden instance to pause here — left at its default (visible)
// on every story below, called out explicitly so a future story that stacks more than one
// <GraphView> in a single render knows to set it false on whichever isn't the one being shown.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { createSignal, getOwner, onCleanup } from 'solid-js'
import type { GraphMode } from './commands'
import { GraphView } from './GraphView'
import { SAMPLE_HUB_ID, sampleGraphData, sampleClusteredGraphData } from './ui/_graphFixtures'
import { settings, setSettings } from './settings'
import { setGraphClusters, setGraphViewMode } from './graph/graphLayers'

const meta = {
    title: 'Graph/GraphView',
    component: GraphView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GraphView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

// The layer signals are MODULE-LEVEL (graph/graphLayers.ts) and shared by every GraphView instance
// in this iframe, and so is the `settings` store holding `graph.gradient` — Storybook navigates
// between stories without reloading, so a story that leaves them flipped leaks into whichever story
// renders next. Every story below calls this at the top of its `render`, before mounting anything,
// so each one is deterministic regardless of click order.
const resetLayers = () => {
    setGraphClusters(true)
    setSettings('graph', 'gradient', false)
    setGraphViewMode('2d')
}

// Fixed px, not vh: the Storybook preview iframe is short with the Controls panel open (see
// Calendar/MonthView.stories.tsx's own note on this), and `.graph-root` fills its parent's
// height (GraphView.module.css `.graph-root { height: 100% }`).
const STORY_H = '640px'

/** The full-pane 2D field: a self node, 8 wikilink-chained notes, a few tags fanning off them —
 *  real coordinates from computeLayout, not hand-placed. `fill` is how the real app always
 *  renders GraphView (App.tsx's one call site never omits it); the 1:1-square fallback only
 *  the `mini` story below exists for cases that don't pass it. */
export const Default: Story = {
    render: () => {
        resetLayers()
        return (
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
        )
    },
}

/** A 60-note graph — same fixture, much larger — to see the field's respacing, hub labelling,
 *  and cluster masses hold up past the everyday small-vault case. `active` points at one of the
 *  generated note ids so the active-file highlight has something real to draw. */
export const LargerGraph: Story = {
    render: () => {
        resetLayers()
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

/** The floating Find panel (`.graph-find-panel`), opened via `play` by clicking the toolbar's
 *  FIND button — `menuOpen` is internal GraphView state with no prop to force it open, and
 *  `props.fill && menuOpen()` gates the panel's render (see GraphView.tsx), so this is the only
 *  way to reach it short of GraphSearch's own standalone stories (which deliberately mount
 *  WITHOUT the `.graph-find-panel` ancestor — see this file's sibling GraphSearch note). Exists
 *  to give `.graph-find-panel:global(.asc-popover)` a story to probe: before this it had none,
 *  and the stray `.graph-find-panel { border-radius: 11px; backdrop-filter: blur(10px) }` bug
 *  the material-unification pass fixed was reachable only in the live app. */
export const FindPanelOpen: Story = {
    render: () => {
        resetLayers()
        return (
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
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const findButton = await canvas.findByText('find')
        findButton.click()
        await canvas.findByPlaceholderText(/search/i)
    },
}

/** The mini graph's contract: its ViewBar header holds EXACTLY ONE 2d/3d TextButton plus
 *  [clusters] and [local], and no bottom bar renders any of them (the bar, when present at all,
 *  carries only the fps badge). `localSelected` is whether [local] must read as showing. Returns
 *  the 2d/3d button. */
const assertMiniHeaderControls = (root: HTMLElement, mode: GraphMode) => {
    const bar = root.querySelector('[data-viewbar]')
    if (!bar) throw new Error('no [data-viewbar] rendered')
    const buttons = [...bar.querySelectorAll('button')]
    const named = (re: RegExp) =>
        buttons.filter(b => re.test(b.textContent?.trim() ?? ''))
    const toggle = named(/^(2d|3d)$/)
    expect(toggle).toHaveLength(1)
    expect(named(/^clusters$/)).toHaveLength(1)
    const local = named(/^local$/)
    expect(local).toHaveLength(1)
    expect(
        /^Showing the open note's neighbourhood/.test(
            local[0]!.getAttribute('title') ?? '',
        ),
    ).toBe(mode === 'local')
    // Nothing the header owns may also render at the floor.
    const floor = root.querySelector('[class*="graph-bottom-bar"]')
    if (floor) {
        expect(floor.querySelectorAll('button')).toHaveLength(0)
    }
    // And no control may clip: every header button sits inside the bar's box, on one row.
    const box = bar.getBoundingClientRect()
    const tops = new Set<number>()
    for (const b of buttons) {
        const r = b.getBoundingClientRect()
        if (r.width === 0) continue
        expect(r.left).toBeGreaterThanOrEqual(box.left - 0.5)
        expect(r.right).toBeLessThanOrEqual(box.right + 0.5)
        tops.add(Math.round(r.top + r.height / 2))
    }
    expect(tops.size).toBe(1)
    return toggle[0]!
}

/**
 * The cramped sidebar slot: `mini` swaps the text-segmented mode switcher for bare icon
 * buttons and adds the bottom-right LOCAL text toggle; sized to the sidebar's own default height
 * (shell/Sidebar.module.css `--sidebar-graph-height, 305px`) rather than the full pane. Mode is "local" — a
 * lens over the open note's neighbourhood, not a sibling of 2nd/3rd/both — which also makes it
 * the one GraphMode this gallery can show without faking the daemon setting: GraphView's own
 * effect resets 3rd/both back to "2nd" while `settings.daemon.enabled` is off (the
 * Storybook default, seeded from the schema DEFAULTS), but "local" isn't gated on that switch.
 * `communitySource` stands in for the full un-mode-filtered vault graph GraphView otherwise
 * reads community/communityPath from for the local layout's community-aware settle (see
 * localLayoutInput.ts) — the same fixture graph serves both roles here.
 *
 * So this story shows the mini bar with NO switcher in it. MiniModeSwitcher below is the one that
 * does fake the setting, and is where the switcher itself is covered.
 */
export const MiniLocal: Story = {
    render: () => {
        resetLayers()
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
    /* Asserts this story's OWN contract — the mini bar here carries no brain switcher, because
       "local" is not gated on the daemon and `modeOptions()` hides a one-option control. It was a
       bare SKIP ("nothing was asserted") before.

       IT IS NOT A CI GUARD AGAINST MiniModeSwitcher'S SETTINGS LEAK, and it was written believing
       it was — say so rather than leaving the next reader to assume the coverage exists. bench/
       playCheck.ts loads each story in its OWN page, so `settings` (one module-level store per
       iframe) starts at DEFAULTS every time and the daemon is off here no matter what the other
       story did. Verified by deleting the `onCleanup` restore and re-running: this story still
       passed. It only catches a real leak in the interactive gallery, where a human navigates
       between stories without a reload.
       The guard that DOES fail in CI is MiniModeSwitcher's own `getOwner()` assertion — an
       unowned `onCleanup` is the one way the restore silently stops running. */
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('[data-viewbar]')
        if (!bar) throw new Error('no [data-viewbar] rendered')
        const modeIcons = [...bar.querySelectorAll('button')].filter(b =>
            /^(2nd brain|3rd brain|Both brains)/i.test(
                b.getAttribute('aria-label') ?? '',
            ),
        )
        expect(modeIcons).toHaveLength(0)

        const modeButton = assertMiniHeaderControls(canvasElement, 'local')

        // Clicking the 2D/3D button flips its OWN label — it always shows the mode you'd switch
        // TO, so after one click it must read the opposite of what it read before. Scoped to
        // `modeButton` itself, not a canvas-wide text query: the FULL-PANE ViewBar's own
        // SegmentedToggle (hidden at this width by a `@container` rule, not by unmounting) still
        // renders its OWN "2D"/"3D" buttons in the DOM, so a bare findByText('2d') matches two
        // elements and throws.
        const before = modeButton.textContent?.trim()
        const after = before === '3d' ? '2d' : '3d'
        modeButton.click()
        await waitFor(() => {
            expect(modeButton.textContent?.trim()).toBe(after)
        })
        // graphViewMode is a MODULE-LEVEL signal persisted to localStorage and shared by every
        // GraphView instance in the gallery — click back to the state this story found it in so
        // later stories still start in 2D.
        modeButton.click()
        await waitFor(() => {
            expect(modeButton.textContent?.trim()).toBe(before)
        })
    },
}

/**
 * THE MINI BAR WITH ALL THREE MODE ICONS — the one story that renders the sidebar's brain
 * switcher, and the only guard on its LEFT ALIGNMENT.
 *
 * MiniLocal above deliberately avoids faking the daemon setting, which is exactly why it cannot
 * cover this: `modeOptions()` (GraphView.tsx) returns a single entry while
 * `settings.daemon.enabled` is off, and the switcher is hidden outright at one option — so every
 * other story in this file renders the mini bar with NO switcher in it. The control the sidebar
 * actually shows a daemon user was invisible to the whole visual gate until this story existed.
 *
 * IT MUTATES THE GLOBAL SETTINGS STORE, AND PUTS IT BACK. `settings` is a module-level Solid
 * store shared by every story in the iframe, not per-story state: Storybook navigates between
 * stories without reloading, so a story that flips `daemon.enabled` and walks away leaves the
 * daemon switched on for whatever the viewer clicks next — silently changing DaemonList, the
 * graph modes and the 3rd-brain surface in stories that never asked for it. Capturing the prior
 * value and restoring it in `onCleanup` (which Solid runs when this story unmounts) is what keeps
 * the mutation scoped to this story. Any future story that needs a setting must copy this shape.
 *
 * The `play()` is the actual assertion, and it is written to FAIL if the mini bar is ever
 * re-centred: it checks the first mode icon starts at the bar's left content edge. Centring put
 * that icon ~75px to the right in a 266px bar, so the numbers are far apart and the check is not
 * a formality. See GraphView.module.css's `@container graphroot (max-width: 520px)` block, whose
 * comment says the same thing from the CSS side.
 */
let miniSwitcherOwned = false

export const MiniModeSwitcher: Story = {
    render: () => {
        resetLayers()
        // OWNER CHECK, ASSERTED IN play() BELOW — this is the whole safety of the restore.
        // `onCleanup` only ever runs if it was registered under a reactive owner; called without
        // one it is a NO-OP that Solid does not throw on, so the restore would silently never
        // happen and the leak this story's note warns about would be back with a green check next
        // to it. Recording the owner here and failing on it in play() turns that silent mode into
        // a loud one if storybook-solidjs-vite ever stops rendering inside a root.
        miniSwitcherOwned = getOwner() !== null

        // Captured BEFORE the write, and restored on unmount — see this story's note above.
        const previous = settings.daemon.enabled
        setSettings('daemon', 'enabled', true)
        onCleanup(() => setSettings('daemon', 'enabled', previous))

        // A live mode, so clicking a mode moves the selection — the pick-one gaps are only proven by
        // looking at every member selected in turn (play() below walks all three).
        const [mode, setMode] = createSignal<GraphMode>('2nd')
        const graph = sampleGraphData(8)
        return (
            <div style={{ height: '305px', width: '266px' }}>
                <GraphView
                    graph={graph}
                    communitySource={graph}
                    onOpen={noop}
                    mode={mode()}
                    setMode={setMode}
                    active={graph.nodes[1]?.id ?? null}
                    fill
                    mini
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The accessible name IS the entire label on these icon-only buttons (GraphView's
        // MODE_HINT), so finding by role+name is also a check that the name survived.
        // ANCHORED WITH `^`, and that is not tidiness: MODE_HINT's 3rd-brain label is "3rd brain —
        // what the daemon remembers…", so an unanchored /brain/i could match more than one button
        // and the query would throw "Found multiple elements" rather than failing on anything real.
        // See the render function: without an owner the restore is a silent no-op.
        expect(miniSwitcherOwned).toBe(true)

        const first = await canvas.findByRole('button', { name: /^2nd brain/i })
        await canvas.findByRole('button', { name: /^3rd brain/i })
        await canvas.findByRole('button', { name: /^Both brains/i })

        const bar = canvasElement.querySelector('[data-viewbar]')
        if (!bar) throw new Error('no [data-viewbar] rendered')
        const barLeft =
            bar.getBoundingClientRect().left +
            parseFloat(getComputedStyle(bar).paddingLeft)

        // LEFT-ALIGNED, not centred: the leading control is the 2d/3d button (a facet, ahead of the
        // icons), so IT starts at the content edge and the first icon follows it. Sub-pixel
        // tolerance only: centring moves it by tens of px.
        const lead = assertMiniHeaderControls(canvasElement, '2nd')
        expect(
            Math.abs(lead.getBoundingClientRect().left - barLeft),
        ).toBeLessThanOrEqual(1)
        expect(first.getBoundingClientRect().left).toBeGreaterThan(
            lead.getBoundingClientRect().right,
        )

        // EVEN GAPS, PICK-ONE (icon-gaps). A unit is `[▣]` for the on mode and the bare glyph for
        // the rest; with each mode selected in turn, every unit-to-unit gap is the same within
        // half a pixel, and the row's width never changes. The on unit's edge is its box minus
        // its side room (the bracket ink sits at the content edge); an off unit's is its glyph.
        const group = first.closest('[role="toolbar"]') as HTMLElement
        const buttons = [...group.querySelectorAll('button')]
        const widths: number[] = []
        for (const button of buttons) {
            button.click()
            await waitFor(() =>
                expect(button.getAttribute('data-state')).toBe('selected'),
            )
            const units = buttons.map(b => {
                if (b.getAttribute('data-state') === 'selected') {
                    const r = b.getBoundingClientRect()
                    const cs = getComputedStyle(b)
                    return {
                        l: r.left + parseFloat(cs.paddingLeft),
                        r: r.right - parseFloat(cs.paddingRight),
                    }
                }
                const r = b.querySelector('svg, img')!.getBoundingClientRect()
                return { l: r.left, r: r.right }
            })
            const gaps = units.slice(1).map((u, i) => u.l - units[i].r)
            expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(0.5)
            widths.push(group.getBoundingClientRect().width)
        }
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5)
        buttons[0].click()
    },
}

/**
 * THE STATUS LINE — the floor's one strip (graph/GraphStatusLine): hovered path left, the
 * `//`-joined readout right, fps appended. Neither half has a prop to force it on from here, so
 * each is forced the way this file's other stateful stories already do, never with a timeout:
 *
 * - 700px wide, past the 521px breakpoint: under it `.graph-status` hides and the bottom bar's own
 *   fps badge takes over, which is the narrow story's job, not this one's.
 * - fps renders only while `settings.graph.showFps` is on AND the renderer has measured a real
 *   frame rate (~500ms of rAF time — AsciiGraphRenderer's fpsAccum). `showFps` is captured, set and
 *   restored in `onCleanup`; the `waitFor` polls for that real callback.
 * - The hover only exists while the pointer is genuinely over a node, so this dispatches a real
 *   `pointermove` at the canvas centre, which lands on the hub note (`SAMPLE_HUB_ID`)
 *   deterministically: the fixture and its layout are pure, and the hub sits at the centroid.
 * - The hub's id is renamed to a 61-char title so the path has to give way to the readout: the
 *   trailing assertions prove the two halves share one row and never overlap.
 */
const LONG_HOVER_LABEL =
    'Quarterly North American Expansion Planning And Budget Review'

export const StatusLine: Story = {
    render: () => {
        resetLayers()
        const previousShowFps = settings.graph.showFps
        setSettings('graph', 'showFps', true)
        onCleanup(() => setSettings('graph', 'showFps', previousShowFps))

        const graph = sampleGraphData(8)
        const rename = (id: string) =>
            id === SAMPLE_HUB_ID ? LONG_HOVER_LABEL : id
        const longLabelGraph = {
            nodes: graph.nodes.map(node => ({ ...node, id: rename(node.id) })),
            edges: graph.edges.map(e => ({
                ...e,
                from: rename(e.from),
                to: rename(e.to),
            })),
        }

        return (
            <div style={{ height: STORY_H, width: '700px' }}>
                <GraphView
                    graph={longLabelGraph}
                    onOpen={noop}
                    mode="2nd"
                    setMode={noop}
                    active={null}
                    fill
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = canvasElement.querySelector('canvas')
        if (!canvas) throw new Error('no canvas rendered')
        const rect = canvas.getBoundingClientRect()
        // Real event, real listener (window-level `pointermove` — see AsciiGraphRenderer.mount):
        // there is no prop seam for the hover state, so this IS the deterministic seam.
        window.dispatchEvent(
            new PointerEvent('pointermove', {
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
                bubbles: true,
            }),
        )
        const path = () =>
            canvasElement.querySelector('[data-testid="graph-status-path"]')!
        const readout = () =>
            canvasElement.querySelector('[data-testid="graph-status-readout"]')!
        await waitFor(
            () => {
                expect(path().textContent).toBe(`${LONG_HOVER_LABEL}.md`)
                expect(path().getBoundingClientRect().width).toBeGreaterThan(0)
            },
            { timeout: 3000 },
        )

        // Waits on the renderer's OWN real fps callback, not a fixed sleep — see the doc comment.
        await waitFor(
            () => {
                expect(readout().textContent ?? '').toMatch(
                    // `[^/]+` (not `.+`) for the mode segment: it cannot swallow a `/`, so a
                    // missing space beside any `//` fails this instead of matching by backtracking.
                    /^\d+ nodes? \/\/ \d+ edges? \/\/ [^/]+ \/\/ \d+% \/\/ \d+ fps$/,
                )
                expect(readout().getBoundingClientRect().width).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )

        // One row: both halves centred on the same line, and the strip sits on the canvas floor.
        const p = path().getBoundingClientRect()
        const r = readout().getBoundingClientRect()
        expect(Math.abs((p.top + p.bottom) / 2 - (r.top + r.bottom) / 2)).toBeLessThanOrEqual(1)
        const strip = canvasElement.querySelector('[data-testid="graph-status"]')!
        expect(
            Math.abs(strip.getBoundingClientRect().bottom - canvas.getBoundingClientRect().bottom),
        ).toBeLessThanOrEqual(1)

        // Never overlaps: the long path gives way before the readout.
        expect(p.right).toBeLessThanOrEqual(r.left)
    },
}

/**
 * THE [clusters] TOGGLE + THE `graph.gradient` SETTING — stories over a real community hierarchy
 * (`sampleClusteredGraphData`, six rings of twelve notes each), which `sampleGraphData` never has.
 * Each sets BOTH layers in `render`, before returning JSX — module state leaks across
 * stories in one Storybook iframe (see `resetLayers` above), so a story cannot rely on whichever
 * state a previous one left the signals in.
 */
const clustered = (clusters: boolean, gradient: boolean, viewMode: '2d' | '3d' = '2d') => () => {
    setGraphClusters(clusters)
    setSettings('graph', 'gradient', gradient)
    setGraphViewMode(viewMode)
    const graph = sampleClusteredGraphData()
    return (
        <div style={{ height: STORY_H, width: '100%' }}>
            <GraphView graph={graph} onOpen={noop} mode="2nd" setMode={noop} active={null} fill />
        </div>
    )
}

/** A real community hierarchy with [clusters] on (the default): zoomed out, each community is one mass. */
export const Clustered: Story = { render: clustered(true, true) }

/** Same graph, [clusters] off: every note glyph, no masses — names thinned to the biggest hubs at fit. */
export const ClustersOff: Story = { render: clustered(false, true) }

/** [clusters] off in 3D: the same flat field orbiting. A graph past flatField.ts's
 *  RANK_CUTS_MIN_NODES also ranks its glyphs and quiets its hub fans; depth only DEMOTES a glyph. */
export const ClustersOff3d: Story = { render: clustered(false, true, '3d') }

/** The sidebar mini graph over the same hierarchy — its [clusters] toggle sits bottom-right beside
 *  [local], driving the same shared signal as the full pane's layer toggles. */
const miniClustered = (clusters: boolean, viewMode: '2d' | '3d' = '2d') => () => {
    setGraphClusters(clusters)
    setSettings('graph', 'gradient', false)
    setGraphViewMode(viewMode)
    const graph = sampleClusteredGraphData()
    return (
        <div style={{ height: '305px', width: '266px' }}>
            <GraphView graph={graph} communitySource={graph} onOpen={noop} mode="2nd" setMode={noop} active={null} fill mini />
        </div>
    )
}

export const MiniClustered: Story = { render: miniClustered(true) }

/** The sidebar mini graph in 3D: a pane this small shrinks the cell exactly like 2D does
 *  (asciiGrid.ts compactScale), while the orbit camera's zoom ceiling stays put. */
export const Mini3d: Story = { render: miniClustered(false, '3d') }

/** [clusters] off in the mini graph: note names at fit are thinned to the pane's row budget
 *  (biggest hubs first), not one on every glyph. */
export const MiniClustersOff: Story = {
    render: miniClustered(false),
    play: async ({ canvasElement }) => {
        const btn = await within(canvasElement).findByRole('button', { name: /clusters/ })
        await expect(btn.getAttribute('aria-pressed')).toBe('false')
    },
}

/** `graph.gradient` off (the default): no bloom canvas, no vignette, flat ground — and no
 *  [gradient] button in the ViewBar. play() flips the setting on and the atmosphere mounts and
 *  inks, then off again and it unmounts (Review Focus 1). */
export const GradientOff: Story = {
    render: clustered(true, false),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await c.findByRole('button', { name: /clusters/ })
        await expect(c.queryByRole('button', { name: /gradient/ })).toBeNull()
        const before = canvasElement.querySelectorAll('canvas').length
        // The bloom canvas's alpha channel is the ink signal: a field that
        // never reached it (Finding 1's bug) leaves every pixel transparent.
        const inked = () => {
            const b = canvasElement.querySelector(
                'canvas[data-mode]',
            ) as HTMLCanvasElement
            const d = b
                .getContext('2d')!
                .getImageData(0, 0, b.width, b.height).data
            let n = 0
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
            return n
        }
        setSettings('graph', 'gradient', true)
        await waitFor(() =>
            expect(canvasElement.querySelectorAll('canvas').length).toBe(
                before + 1,
            ),
        )
        await waitFor(() => expect(inked()).toBeGreaterThan(0))
        // The at-rest replay is pinned renderer-free by GraphAtmosphere's
        // ReplaysLastFieldOnMount story: live dirty frames make it
        // unisolatable here.
        setSettings('graph', 'gradient', false)
        await waitFor(() =>
            expect(canvasElement.querySelectorAll('canvas').length).toBe(
                before,
            ),
        )
    },
}
