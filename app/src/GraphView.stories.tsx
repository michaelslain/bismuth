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
// mounts inside GraphView while the [gradient] toggle (graph/graphLayers.ts) is on — the default —
// so every story below exercises it as a real layer for free unless the story turns it off.
//
// `visible` pauses the renderer's rAF loop (in the app it stops a hidden sidebar slot from
// burning frames while the main pane shows the graph). Storybook only ever mounts one story's
// canvas at a time, so there's no hidden instance to pause here — left at its default (visible)
// on every story below, called out explicitly so a future story that stacks more than one
// <GraphView> in a single render knows to set it false on whichever isn't the one being shown.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { getOwner, onCleanup } from 'solid-js'
import { GraphView } from './GraphView'
import { SAMPLE_HUB_ID, sampleGraphData, sampleClusteredGraphData } from './ui/_graphFixtures'
import { settings, setSettings } from './settings'
import { setGraphClusters, setGraphGradient } from './graph/graphLayers'

const meta = {
    title: 'Graph/GraphView',
    component: GraphView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GraphView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

// Both layer signals are MODULE-LEVEL (graph/graphLayers.ts) and shared by every GraphView instance
// in this iframe — Storybook navigates between stories without reloading, so a story that leaves
// them flipped leaks into whichever story renders next. Every story below calls this at the top of
// its `render`, before mounting anything, so each one is deterministic regardless of click order.
const resetLayers = () => {
    setGraphClusters(true)
    setGraphGradient(true)
}

// Fixed px, not vh: the Storybook preview iframe is short with the Controls panel open (see
// Calendar/MonthView.stories.tsx's own note on this), and `.graph-root` fills its parent's
// height (App.css `.graph-root { height: 100% }`).
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

/**
 * The cramped sidebar slot: `mini` swaps the text-segmented mode switcher for bare icon
 * buttons and adds the bottom-right LOCAL text toggle; sized to the sidebar's own default height
 * (App.css `--sidebar-graph-height, 305px`) rather than the full pane. Mode is "local" — a
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

        // The bottom bar's left cluster is now a SINGLE 2D/3D TextButton in the mini graph (task
        // 1: slim the mini bar) — assert the COUNT, not mere existence, so a regression back to
        // the two-segment toggle fails this.
        const bottomBar = canvasElement.querySelector(
            '[class*="graph-bottom-bar"]',
        )
        if (!bottomBar) throw new Error('no bottom bar rendered')
        const leftCluster = bottomBar.querySelector(
            '[class*="graph-bottom-narrow"]',
        )
        if (!leftCluster) throw new Error('no left cluster rendered')
        const modeButtons = [...leftCluster.querySelectorAll('button')].filter(
            b => /^(2d|3d)$/.test(b.textContent?.trim() ?? ''),
        )
        expect(modeButtons).toHaveLength(1)
        const modeButton = modeButtons[0]!

        // LOCAL is a text button. This story's mode is "local", so it must read as SELECTED — its
        // title is the "showing…" string only in that state. Exactly one, so a second LOCAL control
        // (or an icon regressing back in beside it) fails the count.
        const localButtons = [...bottomBar.querySelectorAll('button')].filter(
            b => b.textContent?.trim() === 'local',
        )
        expect(localButtons).toHaveLength(1)
        expect(localButtons[0]!.getAttribute('title') ?? '').toMatch(
            /^Showing the open note's neighbourhood/,
        )

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

        const graph = sampleGraphData(8)
        return (
            <div style={{ height: '305px', width: '266px' }}>
                <GraphView
                    graph={graph}
                    communitySource={graph}
                    onOpen={noop}
                    mode="2nd"
                    setMode={noop}
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

        // LEFT-ALIGNED, not centred. Sub-pixel tolerance only: this must not quietly pass for a
        // bar that drifted a few px, and centring moves it by tens of px.
        expect(
            Math.abs(first.getBoundingClientRect().left - barLeft),
        ).toBeLessThanOrEqual(1)
    },
}

/**
 * THE HUD BADGES — the hover-label pill and the `.graph-stats` readout, shown together (Task 3,
 * ds-polish: "one size, one baseline, full separators" — both at `--fs-ui`, bottoms aligned).
 * Neither has a prop to force it on, so each is forced the way this file's other stateful stories
 * already do (see MiniModeSwitcher above), never with a `setTimeout`-and-hope:
 *
 * - The frame is a fixed 700px wide, not `STORY_H`'s usual `width: '100%'` — and NOT the narrow
 *   480px this story used before Task 3. `.graph-stats` is `display: none` under
 *   `@container grapharea (max-width: 520px)` (GraphView.module.css), so a narrow render — the
 *   old choice — showed the hover pill and the bottom bar's OWN separate fps badge
 *   (`.graph-bottom-fps`) but never `.graph-stats` itself, which is exactly the gap this task's
 *   ruling calls out ("currently shows the hover badge and the fps pill but no node/edge
 *   readout"). 700px sits comfortably past the 521px breakpoint, so `.graph-stats` renders (with
 *   its own embedded fps segment) and the narrow bottom-bar's `.graph-bottom-narrow`/
 *   `.graph-bottom-fps` correctly hide instead — the same responsive split every other width
 *   already gets, not a new rule.
 * - The fps segment only renders while `settings.graph.showFps` is on (default off) AND the
 *   renderer has measured a real frame rate — its own accumulator only calls back once ~500ms of
 *   REAL rAF time has elapsed (AsciiGraphRenderer's fpsAccum). `showFps` is flipped the same way
 *   MiniModeSwitcher flips `daemon.enabled`: captured, set, restored in `onCleanup`. The `waitFor`
 *   below polls for that real callback to have fired — a genuine settled signal, not a guess.
 * - The hover pill only renders while the mouse is genuinely over a node (`hovered()`, set by the
 *   renderer's own `pointermove` listener on `window` — see AsciiGraphRenderer.ts). There is no
 *   prop to fake a hover, so this dispatches a REAL synthetic `pointermove` at the exact center of
 *   the canvas. That lands on the index hub note (`SAMPLE_HUB_ID`) deterministically, not by luck:
 *   `sampleGraphData(8)` and its layout (`computeLayout`) are pure functions of fixed inputs, and
 *   the hub sits at the layout's centroid (it links to every other note) — the renderer
 *   fits+centers the world in the canvas regardless of aspect ratio, so the hub's cell stays
 *   under the canvas's own center point at this width just as it did at the old 480px one
 *   (verified empirically the same way: the center always lands inside a node's cell).
 * - Both `waitFor`s below also assert a non-zero bounding box, not just presence + text — a
 *   `display: none` badge still has DOM text, so text alone doesn't prove it's visible (this is
 *   exactly how the fps pill's invisibility at full width went unnoticed before).
 * - The trailing assertions check the ruling's own claims directly: "bottoms aligned" — the hover
 *   pill and the `.graph-stats` box share the same CSS `bottom` (6px) / flex `align-items: center`,
 *   which pins both boxes' bottom edges to the same Y regardless of their differing heights/padding
 *   — and "never overlaps" (fix-2-4, ds-polish): the hub note's id is renamed to a 61-char
 *   title, a length nothing bounded the hover pill's width against before `.graph-stats` moved off
 *   `position: absolute` to become the bottom bar's last flex child (GraphView.module.css). A
 *   local fixture override, not a change to `sampleGraphData` itself, which every other story here
 *   also uses — `hoverLabel()` (GraphView.tsx) shows a note as `<id>.md`, so renaming the hub's id
 *   (and the edges that name it) is the deterministic way to grow the hover pill's text without
 *   disturbing which node the centered pointermove below lands on (still the hub, still at the
 *   canvas center, same guarantee the doc comment above already established).
 */
const LONG_HOVER_LABEL =
    'Quarterly North American Expansion Planning And Budget Review'

export const HudBadges: Story = {
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
        await waitFor(
            () => {
                const pill = canvasElement.querySelector(
                    '[class*="graph-hud-hover"]',
                )
                expect(pill).not.toBeNull()
                expect(pill!.textContent).not.toBe('')
                const box = pill!.getBoundingClientRect()
                expect(box.width).toBeGreaterThan(0)
                expect(box.height).toBeGreaterThan(0)
            },
            { timeout: 3000 },
        )

        // Waits on the renderer's OWN real fps callback (500ms of accumulated frame time), not a
        // fixed sleep — see this story's doc comment. The fps segment now lives INSIDE the wide
        // `.graph-stats` readout (Task 3), not the narrow bottom-bar's own fps badge, which this
        // width hides on purpose.
        await waitFor(
            () => {
                const stats = canvasElement.querySelector(
                    '[class*="graph-stats"]',
                )
                expect(stats).not.toBeNull()
                expect(stats!.textContent ?? '').toMatch(
                    // `[^/]+` (not `.+`) for the mode segment: it cannot swallow a `/`, so a
                    // missing space beside any `//` (the flex-item edge-trimming bug this task's
                    // JSX works around — see GraphView.tsx's note) fails this instead of silently
                    // matching via backtracking.
                    /^\d+ nodes? \/\/ \d+ edges? \/\/ [^/]+ \/\/ \d+% \/\/ \d+ fps$/,
                )
                const box = stats!.getBoundingClientRect()
                expect(box.width).toBeGreaterThan(0)
                expect(box.height).toBeGreaterThan(0)
            },
            { timeout: 5000 },
        )

        // Bottoms aligned — the ruling's own acceptance check, not just "both visible".
        const hoverPill = canvasElement.querySelector('[class*="graph-hud-hover"]')!
        const stats = canvasElement.querySelector('[class*="graph-stats"]')!
        expect(
            Math.abs(
                hoverPill.getBoundingClientRect().bottom -
                    stats.getBoundingClientRect().bottom,
            ),
        ).toBeLessThanOrEqual(1)

        // Never overlaps (fix-2-4): confirms this IS the long-label render, then proves the hover
        // pill's right edge stays clear of the readout's left edge — the regression this story
        // exists to catch. Before the readout moved off `position: absolute`, nothing bounded the
        // pill's width above 520px and a label this long painted straight over the readout text.
        expect(hoverPill.textContent).toBe(`${LONG_HOVER_LABEL}.md`)
        expect(hoverPill.getBoundingClientRect().right).toBeLessThanOrEqual(
            stats.getBoundingClientRect().left,
        )
    },
}

/**
 * THE [clusters]/[gradient] TOGGLES — three stories over a real community hierarchy
 * (`sampleClusteredGraphData`, six rings of twelve notes each), which `sampleGraphData` never has.
 * Each sets BOTH layer signals in `render`, before returning JSX — module state leaks across
 * stories in one Storybook iframe (see `resetLayers` above), so a story cannot rely on whichever
 * state a previous one left the signals in.
 */
const clustered = (clusters: boolean, gradient: boolean) => () => {
    setGraphClusters(clusters)
    setGraphGradient(gradient)
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

/** The sidebar mini graph over the same hierarchy — its [clusters] toggle sits bottom-right beside
 *  [local], driving the same shared signal as the full pane's layer toggles. */
const miniClustered = (clusters: boolean) => () => {
    setGraphClusters(clusters)
    setGraphGradient(true)
    const graph = sampleClusteredGraphData()
    return (
        <div style={{ height: '305px', width: '266px' }}>
            <GraphView graph={graph} communitySource={graph} onOpen={noop} mode="2nd" setMode={noop} active={null} fill mini />
        </div>
    )
}

export const MiniClustered: Story = { render: miniClustered(true) }

/** [clusters] off in the mini graph: note names at fit are thinned to the pane's row budget
 *  (biggest hubs first), not one on every glyph. */
export const MiniClustersOff: Story = {
    render: miniClustered(false),
    play: async ({ canvasElement }) => {
        const btn = await within(canvasElement).findByRole('button', { name: /clusters/ })
        await expect(btn.getAttribute('aria-pressed')).toBe('false')
    },
}

/** [gradient] off: no bloom canvas, no vignette, flat ground. play() turns it back on and the
 *  atmosphere remounts (Review Focus 1). */
export const GradientOff: Story = {
    render: clustered(true, false),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const btn = await c.findByRole('button', { name: /gradient/ })
        await expect(btn.getAttribute('aria-pressed')).toBe('false')
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
        await userEvent.click(btn)
        await waitFor(() =>
            expect(canvasElement.querySelectorAll('canvas').length).toBe(
                before + 1,
            ),
        )
        await waitFor(() => expect(inked()).toBeGreaterThan(0))
        // The at-rest replay is pinned renderer-free by GraphAtmosphere's
        // ReplaysLastFieldOnMount story: live dirty frames make it
        // unisolatable here.
        await userEvent.click(btn)
        await waitFor(() =>
            expect(canvasElement.querySelectorAll('canvas').length).toBe(
                before,
            ),
        )
    },
}
