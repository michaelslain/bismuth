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
import { expect, waitFor, within } from 'storybook/test'
import { getOwner, onCleanup } from 'solid-js'
import { GraphView } from './GraphView'
import { sampleGraphData } from './ui/_graphFixtures'
import { settings, setSettings } from './settings'

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

/** The floating Find panel (`.graph-find-panel`), opened via `play` by clicking the toolbar's
 *  FIND button — `menuOpen` is internal GraphView state with no prop to force it open, and
 *  `props.fill && menuOpen()` gates the panel's render (see GraphView.tsx), so this is the only
 *  way to reach it short of GraphSearch's own standalone stories (which deliberately mount
 *  WITHOUT the `.graph-find-panel` ancestor — see this file's sibling GraphSearch note). Exists
 *  to give `.graph-find-panel:global(.asc-popover)` a story to probe: before this it had none,
 *  and the stray `.graph-find-panel { border-radius: 11px; backdrop-filter: blur(10px) }` bug
 *  the material-unification pass fixed was reachable only in the live app. */
export const FindPanelOpen: Story = {
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
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const findButton = await canvas.findByText('FIND')
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
        const bar = canvasElement.querySelector('.viewbar')
        if (!bar) throw new Error('no .viewbar rendered')
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
            b => /^(2D|3D)$/.test(b.textContent?.trim() ?? ''),
        )
        expect(modeButtons).toHaveLength(1)
        const modeButton = modeButtons[0]!

        // LOCAL is a text button. This story's mode is "local", so it must read as SELECTED — its
        // title is the "showing…" string only in that state. Exactly one, so a second LOCAL control
        // (or an icon regressing back in beside it) fails the count.
        const localButtons = [...bottomBar.querySelectorAll('button')].filter(
            b => b.textContent?.trim() === 'LOCAL',
        )
        expect(localButtons).toHaveLength(1)
        expect(localButtons[0]!.getAttribute('title') ?? '').toMatch(
            /^Showing the open note's neighbourhood/,
        )

        // Clicking the 2D/3D button flips its OWN label — it always shows the mode you'd switch
        // TO, so after one click it must read the opposite of what it read before. Scoped to
        // `modeButton` itself, not a canvas-wide text query: the FULL-PANE ViewBar's own
        // SegmentedToggle (hidden at this width by a `@container` rule, not by unmounting) still
        // renders its OWN "2D"/"3D" buttons in the DOM, so a bare findByText('2D') matches two
        // elements and throws.
        const before = modeButton.textContent?.trim()
        const after = before === '3D' ? '2D' : '3D'
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

        const bar = canvasElement.querySelector('.viewbar')
        if (!bar) throw new Error('no .viewbar rendered')
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
