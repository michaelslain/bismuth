// Visual spec for <GraphFloater> — the always-mounted Knowledge Graph wrapper, floated over
// whichever slot is currently active (sidebar mini-square, full main pane, or a tab's graph pane).
//
// WHAT THESE STORIES ARE: the floater is `position: fixed`, so on its own it has no geometry — App's
// `placeFloater` writes top/left/width/height from a slot's `getBoundingClientRect()`. Every story
// here does the same in `onMount` (the pattern Sidebar.stories.tsx's `DockedGraph` established), so
// each shows the floater sitting on a REAL slot with a REAL <GraphView> (fixture graph, the preview's
// fakeTransport) inside: a real <Sidebar> with its graph square, or a note-coloured main area.
//
// FOUR STORIES: `Floating` — resting, full-size over the main area. `Docked` — the `clip-path` inset
// that shrinks the graph into a left sidebar's mini-square. `DockedRight` — the right sidebar, the
// mirror: `--sidebar-w` is set below the token's own 266px so the clip visibly eats the LEFT edge,
// asserted from the computed clip-path. `Parked` — no slot to sit on (the graph is left out of the
// sidebar's sections): present but invisible and inert.
//
// `--sidebar-w`/`--sidebar-width` are set on the wrapper so the docked clip's `calc()` resolves —
// the token's OWN default (266px), never an invented stand-in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { onMount } from 'solid-js'
import { GraphFloater } from './GraphFloater'
import { Sidebar } from './Sidebar'
import { CommandButton } from './CommandButton'
import { GraphView } from '../GraphView'
import { sampleGraphData } from '../ui/_graphFixtures'
import Text from '../ui/Text'

const noop = () => {}

const meta = {
    title: 'Shell/GraphFloater',
    component: GraphFloater,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GraphFloater>

export default meta
type Story = StoryObj<typeof meta>

// Fixed px, not vh: the preview iframe is short with the Controls panel open.
const H = '480px'

const toolbar = () => (
    <>
        <CommandButton icon="Search" label="Search" onClick={noop} />
        <CommandButton icon="Inbox" label="Inbox" onClick={noop} />
        <CommandButton icon="Settings" label="Settings" onClick={noop} />
    </>
)

const tree = () => (
    <div style={{ padding: '4px 8px' }}>
        <Text size="ui" tone="muted">
            projects/
        </Text>
        <Text size="ui">roadmap.md</Text>
        <Text size="ui">reading-list.md</Text>
        <Text size="ui">design-notes.md</Text>
        <Text size="ui" tone="muted">
            journal/
        </Text>
    </div>
)

const note = () => (
    <div style={{ padding: '16px 20px' }}>
        <Text register="prose" size="lead" weight="medium">
            Roadmap
        </Text>
        <Text register="prose" tone="muted">
            Ship the shell layout, then the graph rework.
        </Text>
    </div>
)

/** A floater with a real GraphView in it. */
const Floater = (props: {
    docked: boolean
    dockSide?: 'left' | 'right'
    parked?: boolean
    mini: boolean
    ref: (el: HTMLDivElement) => void
}) => (
    <GraphFloater
        docked={props.docked}
        dockSide={props.dockSide}
        parked={props.parked}
        ref={props.ref}
    >
        <GraphView
            fill
            mini={props.mini}
            visible={!props.parked}
            graph={sampleGraphData(8)}
            onOpen={noop}
            mode="2nd"
            setMode={noop}
            active={null}
        />
    </GraphFloater>
)

/** Snap `floater` onto `slot`'s rect — what App.tsx's `placeFloater` does. */
const snap = (slot: HTMLElement, floater: HTMLElement) => {
    const r = slot.getBoundingClientRect()
    floater.style.top = `${r.top}px`
    floater.style.left = `${r.left}px`
    floater.style.width = `${r.width}px`
    floater.style.height = `${r.height}px`
}

/** The graph floating full-size over the whole main area, as with no tabs open. */
export const Floating: Story = {
    render: () => {
        let slot: HTMLDivElement | undefined
        let floater: HTMLDivElement | undefined
        onMount(() => slot && floater && snap(slot, floater))
        return (
            <div style={{ height: H, background: 'var(--bg)' }}>
                <div ref={slot} style={{ height: '100%' }} />
                <Floater
                    docked={false}
                    mini={false}
                    ref={el => (floater = el)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector<HTMLElement>(
            '[data-graph-floater]',
        )
        expect(el).not.toBeNull()
        expect(el!.getBoundingClientRect().height).toBeGreaterThan(300)
        expect(getComputedStyle(el!).clipPath).toBe('none')
    },
}

/** `docked` — a left sidebar's graph square with the floater snapped onto it: the clip-path inset
 *  that shrinks the graph into the mini-square, beside a note. */
export const Docked: Story = {
    render: () => {
        let slot: HTMLDivElement | undefined
        let floater: HTMLDivElement | undefined
        onMount(() => slot && floater && snap(slot, floater))
        return (
            <div
                style={{
                    display: 'grid',
                    'grid-template-columns':
                        'var(--sidebar-width, 266px) minmax(0, 1fr)',
                    height: H,
                    '--sidebar-w': 'var(--sidebar-width, 266px)',
                }}
            >
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={el => (slot = el)}
                    toolbar={toolbar()}
                    tree={tree()}
                />
                <div style={{ background: 'var(--bg)' }}>{note()}</div>
                <Floater docked={true} mini={true} ref={el => (floater = el)} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector<HTMLElement>(
            '[data-graph-floater]',
        )
        expect(el).not.toBeNull()
        expect(el!.getBoundingClientRect().width).toBeGreaterThan(0)
        expect(getComputedStyle(el!).clipPath).not.toBe('none')
    },
}

/** `dockSide="right"` — the sidebar on the window's right, flush to the canvas's right edge. The
 *  story rests at full width; its play drives `--sidebar-w` to 200px (mid-collapse) to prove the
 *  clip eats the floater's LEFT edge, then restores it so the shot shows the resting sidebar. */
export const DockedRight: Story = {
    render: () => {
        let slot: HTMLDivElement | undefined
        let floater: HTMLDivElement | undefined
        onMount(() => slot && floater && snap(slot, floater))
        return (
            <div
                style={{
                    display: 'grid',
                    'grid-template-columns': 'minmax(0, 1fr) var(--sidebar-w)',
                    height: H,
                    '--sidebar-width': '266px',
                    '--sidebar-w': '266px',
                }}
            >
                <div style={{ background: 'var(--bg)' }}>{note()}</div>
                <div
                    style={{
                        display: 'flex',
                        'justify-content': 'flex-end',
                        overflow: 'hidden',
                        'min-width': '0',
                    }}
                >
                    <div
                        style={{
                            width: '266px',
                            flex: 'none',
                            display: 'grid',
                        }}
                    >
                        <Sidebar
                            visible={true}
                            graphCollapsed={false}
                            graphSlotRef={el => (slot = el)}
                            toolbar={toolbar()}
                            tree={tree()}
                            side="right"
                        />
                    </div>
                </div>
                <Floater
                    docked={true}
                    dockSide="right"
                    mini={true}
                    ref={el => (floater = el)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector<HTMLElement>(
            '[data-graph-floater]',
        )
        expect(el).not.toBeNull()
        const wrap = el!.parentElement!
        wrap.style.setProperty('--sidebar-w', '200px')
        // inset(top right bottom left): only the LEFT inset (266 - 200 = 66px) is non-zero.
        const parts = getComputedStyle(el!)
            .clipPath.match(/-?[\d.]+px/g)
            ?.map(parseFloat)
        expect(parts).toBeTruthy()
        const [top, right, bottom, left] = parts!
        expect(left).toBeCloseTo(66, 0)
        expect(right).toBe(0)
        expect(top).toBe(0)
        expect(bottom).toBe(0)
        // Back to rest: nothing clipped, so the shot shows the whole right sidebar.
        wrap.style.setProperty('--sidebar-w', '266px')
        const rest = getComputedStyle(el!)
            .clipPath.match(/-?[\d.]+px/g)
            ?.map(parseFloat)
        expect(rest?.every(v => v === 0) ?? true).toBe(true)
    },
}

/** `parked` — no slot to sit on: the sidebar carries no graph section, so the floater stays
 *  mounted but invisible and inert. */
export const Parked: Story = {
    render: () => {
        let slot: HTMLDivElement | undefined
        let floater: HTMLDivElement | undefined
        onMount(() => slot && floater && snap(slot, floater))
        return (
            <div
                style={{
                    display: 'grid',
                    'grid-template-columns':
                        'var(--sidebar-width, 266px) minmax(0, 1fr)',
                    height: H,
                    '--sidebar-w': 'var(--sidebar-width, 266px)',
                }}
            >
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={noop}
                    toolbar={toolbar()}
                    tree={tree()}
                    sections={['toolbar', 'files']}
                />
                <div ref={slot} style={{ background: 'var(--bg)' }}>
                    {note()}
                </div>
                <Floater
                    docked={true}
                    parked={true}
                    mini={true}
                    ref={el => (floater = el)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector<HTMLElement>(
            '[data-graph-floater]',
        )
        if (!el) throw new Error('floater not mounted')
        const cs = getComputedStyle(el)
        if (cs.visibility !== 'hidden' || cs.pointerEvents !== 'none')
            throw new Error('not parked')
    },
}
