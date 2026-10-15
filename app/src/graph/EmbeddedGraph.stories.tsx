// Visual spec for <EmbeddedGraph> — the rendered face of a ```graph note block. It takes a
// plain `source: string` (the block's raw DSL body, NOT including the fence markers), parses
// it with core/src/graphBlock.ts's parseGraphBlock, and lays it out CLIENT-SIDE with the same
// pure layout the knowledge graph itself uses (core/src/layout.ts's computeLayout, via the
// sibling embeddedGraphRender.ts) — no network call, no backend round-trip, nothing to fake.
//
// `onReveal`/`onChange` are the widget's own edit affordances (toggle the raw-source view;
// write a mutated spec back into the note's fence via a doc transaction). Both are no-ops
// here — there's no fence for a story to write back into, and the toolbar/canvas render
// identically either way.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { EmbeddedGraph } from './EmbeddedGraph'
import type { AsciiGraphStats } from './AsciiGraphRenderer'
import { settings, setSettings } from '../settings'

const meta = {
    title: 'Graph/EmbeddedGraph',
    component: EmbeddedGraph,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof EmbeddedGraph>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** A small directed chain plus one undirected edge — the DSL's everyday shape: `id: label`
 *  node lines, `a -> b` / `a -- b` edge lines (endpoints declared implicitly on first mention). */
const SIMPLE_SOURCE = `alpha: Alpha
beta: Beta
gamma: Gamma
alpha -> beta
beta -> gamma
gamma -- alpha
`

export const Default: Story = {
    render: () => (
        <EmbeddedGraph source={SIMPLE_SOURCE} onReveal={noop} onChange={noop} />
    ),
}

/** Labeled edges (`a -> b: label`) mixing directed and undirected links in one diagram — the
 *  block's full edge-line grammar. */
const LABELED_SOURCE = `alice: Alice
bob: Bob
carol: Carol
dave: Dave
alice -> bob: manages
bob -> carol: mentors
carol -- dave: peer of
dave -> alice
`

export const LabeledEdges: Story = {
    render: () => (
        <EmbeddedGraph
            source={LABELED_SOURCE}
            onReveal={noop}
            onChange={noop}
        />
    ),
    // Canvas text is not in the DOM, so the renderer's own stats hook is the proof the three captions
    // (`manages`, `mentors`, `peer of`) were PAINTED — a count of zero is exactly the defect this story
    // used to show (the label died in graphBlockToGraphData and the story claimed labels it never drew).
    // `dave -> alice` carries none, so 3 and not 4.
    play: async () => {
        await waitFor(() => expect(graphStats().edgeLabelsDrawn).toBe(3), {
            timeout: 3000,
        })
    },
}

/**
 * Malformed source: a dangling arrow with no right-hand token, then an unterminated quoted
 * token — mirrors core/test/graphBlock.test.ts's "bad statements are reported with 1-based
 * line numbers and skipped" fixture. The parser reports each bad line and skips it rather
 * than dropping the whole diagram, so the well-formed nodes (`alpha`, `beta`, `ok`) still
 * parse and render; the edit toolbar collapses to just the 2D/3D toggle + source button
 * (SELECT/CONNECT/ERASE/+NODE all require a clean parse — see EmbeddedGraph.tsx's `hasErrors`
 * guard) while the error banner lists what's wrong.
 */
const ERROR_SOURCE = `alpha -> beta
alpha ->
"unterminated
ok
`

export const ParseErrors: Story = {
    render: () => (
        <EmbeddedGraph source={ERROR_SOURCE} onReveal={noop} onChange={noop} />
    ),
}

/** The connect tool: the direction pair (`->` / `--`, pick-one icons) appears beside the three
 *  tools, `--sp-2` apart, with `[+ node]` after it. The story ends in connect mode (the resting
 *  frame); the tool is a module-level signal, so NodeSelected re-selects `select` itself. */
export const ConnectTool: Story = {
    render: () => (
        <EmbeddedGraph source={SIMPLE_SOURCE} onReveal={noop} onChange={noop} />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByTitle(/^Connect/))
        await waitFor(() => {
            expect(c.getByLabelText('directed')).toBeVisible()
            expect(c.getByLabelText('undirected')).toBeVisible()
        })
        expect(c.getByLabelText('directed').getAttribute('aria-pressed')).toBe(
            'true',
        )
        await userEvent.click(c.getByLabelText('undirected'))
        await waitFor(() =>
            expect(
                c.getByLabelText('undirected').getAttribute('aria-pressed'),
            ).toBe('true'),
        )
    },
}

/** A node selected: the edit row (id, label, `[apply]`, `[delete]`) opens under the canvas. The
 *  renderer hit-tests a real pointer press-and-release, so the play scans the canvas for a node
 *  until the edit row appears. Left selected; the next story's remount starts clean. */
export const NodeSelected: Story = {
    render: () => (
        <EmbeddedGraph source={SIMPLE_SOURCE} onReveal={noop} onChange={noop} />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await waitFor(() => expect(graphStats().zoomPct).toBe(100), {
            timeout: 3000,
        })
        // Make sure the select tool is up (the tool signal outlives a story).
        await userEvent.click(c.getByTitle(/^Select/))
        const viewport = canvasElement.querySelector<HTMLElement>(
            '.asc-graph-viewport',
        )!
        const box = viewport.getBoundingClientRect()
        const opened = () => c.queryByLabelText('id') !== null
        for (let fy = 0.15; fy < 0.9 && !opened(); fy += 0.05) {
            for (let fx = 0.1; fx < 0.95 && !opened(); fx += 0.025) {
                const x = box.left + box.width * fx
                const y = box.top + box.height * fy
                const init = {
                    bubbles: true,
                    button: 0,
                    clientX: x,
                    clientY: y,
                }
                viewport.dispatchEvent(new PointerEvent('pointerdown', init))
                window.dispatchEvent(new PointerEvent('pointerup', init))
                await settleFrames(1)
            }
        }
        await waitFor(() => expect(c.getByLabelText('id')).toBeVisible())
        expect(c.getByText('delete')).toBeVisible()
    },
}

// EmbeddedGraph mounts a real `AsciiGraphRenderer` (`new AsciiGraphRenderer()` + `.mount()`) —
// the SAME renderer + the SAME onKeyDown the knowledge graph pane uses — so its keyboard
// handling is provable here without GraphView's chrome. GraphView's rAF-pause-on-hidden-tab
// trap (see CLAUDE.md) lives in GraphView.tsx itself, not in the renderer, so it doesn't apply
// to this widget — but canvas pixels are still the wrong thing to assert on on principle: read
// the DEV-only `window.__asciiGraphStats()` hook (AsciiGraphRenderer.computeStats) instead,
// which reports `zoomPct` as a plain number each rendered frame.
function graphStats(): AsciiGraphStats {
    const w = window as unknown as {
        __asciiGraphStats?: () => AsciiGraphStats
    }
    if (!w.__asciiGraphStats)
        throw new Error('graph stats hook not installed yet')
    return w.__asciiGraphStats()
}

/** `window.dispatchEvent` for a "real" press (matches how AsciiGraphRenderer.mount() attaches
 *  its listener: `window.addEventListener('keydown', this.onKeyDown)`), or dispatched ON a
 *  given target so it bubbles to window with `e.target` set to that element — the only way to
 *  make the contentEditable/INPUT/TEXTAREA guard see a real target (KeyboardEvent has no
 *  settable `target` property). */
function press(init: KeyboardEventInit, target: EventTarget = window) {
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ...init,
        }),
    )
}

/** Wait out a fixed number of real animation frames — the renderer's own glide is rAF-driven
 *  (GLIDE_TAU_MS), so this is how long its state needs to catch up, not a guessed duration. Used
 *  only to prove a NEGATIVE (a guarded/inert keydown left `zoomPct` untouched): the positive
 *  assertions above it already prove a real change reliably shows up well within this many
 *  frames, so if the value is still unchanged after they've had the same amount of time, it
 *  never fired. */
function settleFrames(n = 8): Promise<void> {
    return new Promise(resolve => {
        let left = n
        const step = () =>
            --left <= 0 ? resolve() : requestAnimationFrame(step)
        requestAnimationFrame(step)
    })
}

/**
 * Proves AsciiGraphRenderer.onKeyDown is genuinely `.settings`-driven, not a hardcoded literal
 * that happens to match today's defaults:
 *   - the DEFAULT combos fire, including the two long zoom spellings (`Shift+=`/`Shift+-` —
 *     a bare `+`/`_` would silently bind nothing: parseCombo splits a combo on `+`, so a lone
 *     `+` parses to null, and Shift is matched EXACTLY so a bare `_` never satisfies a combo
 *     that doesn't name Shift)
 *   - Escape and an unhovered `z` both reset the view (hoveredId is null outside a real pointer
 *     hover, which this story doesn't simulate — see EmbeddedGraph's onNodeClick/applyHover)
 *   - the contentEditable/INPUT/TEXTAREA guard this task must NOT touch is still intact
 *   - a REBIND of `graph-zoom-in` moves the live binding and retires the old key — the half a
 *     helper that only ADDS the new binding alongside the old one would fail
 */
export const KeyboardShortcuts: Story = {
    render: () => (
        <EmbeddedGraph source={SIMPLE_SOURCE} onReveal={noop} onChange={noop} />
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(graphStats().zoomPct).toBe(100), {
            timeout: 3000,
        })

        // DEFAULT zoom-in: bare '=' steps resolution percent DOWN by 10 (more resolution).
        press({ key: '=', code: 'Equal' })
        await waitFor(() => expect(graphStats().zoomPct).toBe(90), {
            timeout: 3000,
        })
        // DEFAULT zoom-in's long alternative: Shift+= (`{ key: '+', code: 'Equal', shiftKey: true }`).
        press({ key: '+', code: 'Equal', shiftKey: true })
        await waitFor(() => expect(graphStats().zoomPct).toBe(80), {
            timeout: 3000,
        })

        // DEFAULT zoom-out: bare '-' steps back up.
        press({ key: '-', code: 'Minus' })
        await waitFor(() => expect(graphStats().zoomPct).toBe(90), {
            timeout: 3000,
        })
        // DEFAULT zoom-out's long alternative: Shift+- (`{ key: '_', code: 'Minus', shiftKey: true }`).
        press({ key: '_', code: 'Minus', shiftKey: true })
        await waitFor(() => expect(graphStats().zoomPct).toBe(100), {
            timeout: 3000,
        })

        // GUARD: a keydown targeting a real INPUT is ignored outright.
        const input = document.createElement('input')
        canvasElement.appendChild(input)
        press({ key: '=', code: 'Equal' }, input)
        await settleFrames()
        expect(graphStats().zoomPct).toBe(100)
        input.remove()

        // Escape resets the view — zoom in first so the reset is observable.
        press({ key: '=', code: 'Equal' })
        await waitFor(() => expect(graphStats().zoomPct).toBe(90), {
            timeout: 3000,
        })
        press({ key: 'Escape', code: 'Escape' })
        await waitFor(() => expect(graphStats().zoomPct).toBe(100), {
            timeout: 3000,
        })

        // 'z' with nothing hovered takes the same reset branch.
        press({ key: '=', code: 'Equal' })
        await waitFor(() => expect(graphStats().zoomPct).toBe(90), {
            timeout: 3000,
        })
        press({ key: 'z', code: 'KeyZ' })
        await waitFor(() => expect(graphStats().zoomPct).toBe(100), {
            timeout: 3000,
        })

        // REBIND: move graph-zoom-in off its default onto 'K'. `settings` is a module-level
        // store shared by the whole Storybook run — restore it no matter how the checks below
        // turn out. AsciiGraphRenderer reads settings.keybindings fresh on every keydown (no
        // subscription/compartment to wait on), so the very next keystroke already sees it.
        const previous = settings.keybindings['graph-zoom-in']
        setSettings('keybindings', 'graph-zoom-in', 'K')
        try {
            // OLD combo now inert.
            press({ key: '=', code: 'Equal' })
            await settleFrames()
            expect(graphStats().zoomPct).toBe(100)

            // NEW combo runs the same command, live.
            press({ key: 'k', code: 'KeyK' })
            await waitFor(() => expect(graphStats().zoomPct).toBe(90), {
                timeout: 3000,
            })
        } finally {
            setSettings('keybindings', 'graph-zoom-in', previous)
        }
    },
}
