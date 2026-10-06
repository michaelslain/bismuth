// Visual spec for <AppFrame> — the outermost shell: top strip, sidebar/editor/rail/graph grid,
// status bar. Every slot is the REAL component, not a placeholder: <TopStrip>, a <Sidebar> with a
// toolbar + a small file tree + a docked <GraphFloater> holding a mini <GraphView>, an <EditorPane>
// with note text, a <TabRail> with <TabRailRow>s, a <StatusBar>, and real <EdgeHandle>s on the
// sidebar and rail lines. `side`/`sections` are passed through so the mirrored stories mirror for
// real. AppFrame itself never learns what those things are, only that it has eight JSX slots.
//
// WHY THIS FILE EXISTS: recorded BEFORE the shell grid and its state rules moved from global.css into
// AppFrame.module.css, and extended when the frame learned which side the sidebar and tab rail sit on
// (`SidebarRight`, `RailLeft`, `BothLeft`, `BothRight`) and to drop the status bar (`NoStatusBar`).
// The real components render at real size: top strip 36px (--h-band), status bar 18px (--row-h), the
// grid filling the rest. The play functions carry the geometry checks (cell order, the sidebar edge
// strip's x and z-order, track widths) that cannot live in a bun test — Solid cannot mount there.
//
// ELEVEN STORIES — the ONLY coverage the grid template will ever have; without them a broken
// `grid-template-columns` ships green. `Default` — sidebar visible, rail present, rail unpinned
// (asserts `--rail-w: 46px`). `SidebarHidden` — `.layout[data-sidebar-hidden]`, the highest-consequence
// Trap-1 instance in the whole plan (a missed hash means the sidebar never hides — see
// AppFrame.tsx's header). `SwitcherActive` — both the sidebar AND rail tracks collapse to 0 in
// lockstep (asserts `--rail-w: 0px`). `NoRail` — `hasRail={false}`, a state the real app never
// actually reaches today (App.tsx always passes `true`) but the prop exists to preserve, so this
// is the only story proving the grid still degrades sanely without it. `RailPinned` — queue item 2:
// pinning the rail must reserve the full 232px in the grid, not just widen the overlay (asserts
// `--rail-w: 232px` AND that the grid track followed it). `RailPinnedUnderSwitcher` — pinned AND
// taken over at once, the one interaction `:not([data-switcher-active])` exists for (asserts `--rail-w:
// 0px`). `Default`, `SwitcherActive` and `RailPinnedUnderSwitcher` now ASSERT rather than merely
// render — they describe currently-correct behaviour a future rule change could break.
//
// WHY `waitFor`, even though nothing below is actually caught mid-transition: the grid carries
// `transition: --rail-w 0.26s var(--ease)` (AppFrame.module.css), so a synchronous read is the wrong default
// whenever a transitioning custom property is being asserted — defensive practice, cheap to keep.
// But do not cite these four play functions as proof `waitFor` is catching a live interpolation
// here: each story mounts with `railPinned` already fixed, so there is no PRIOR state for the
// transition to animate FROM, and `--rail-w` reads its resting value on the very first frame the
// element exists. The case that actually exercises a post-mount transition is
// `shell-tabrail--expanded`'s hover interaction — see bench/chromeSession.ts's header, which cites
// that exact story as the reason playCheck.ts runs real, un-forced-motion Chrome for interaction
// assertions in the first place.
//
// EXPLICIT-HEIGHT WRAPPER: the app shell is `height: 100%`, and Storybook's default `layout:
// "centered"` canvas has no intrinsic height, so it would collapse to zero. Uses
// `parameters: { layout: "fullscreen" }` + a `height: 100vh` wrapper instead.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { onMount } from 'solid-js'
import { AppFrame } from './AppFrame'
import { TopStrip } from './TopStrip'
import { Sidebar } from './Sidebar'
import { CommandButton } from './CommandButton'
import { EditorPane } from './EditorPane'
import { TabRail } from './TabRail'
import { TabRailRow } from './TabRailRow'
import { StatusBar } from './StatusBar'
import { GraphFloater } from './GraphFloater'
import EdgeHandle from './EdgeHandle'
import { GraphView } from '../GraphView'
import { sampleGraphData } from '../ui/_graphFixtures'
import Text from '../ui/Text'

type FrameProps = Parameters<typeof AppFrame>[0]

const noop = () => {}

/** The real shell slots for one story. Called inside `render` so each story gets its own
 *  components and its own floater placement (what App.tsx's `placeFloater` does: snap the
 *  `position: fixed` floater onto the sidebar's graph slot in `onMount`). */
const frame = (p: Partial<FrameProps> = {}) => {
    const sidebarSide = p.sidebarSide ?? 'left'
    const tabRailSide = p.tabRailSide ?? 'right'
    const sidebarHidden = p.sidebarHidden ?? false
    const railPinned = p.railPinned ?? false
    let slot: HTMLDivElement | undefined
    let floater: HTMLDivElement | undefined
    onMount(() => {
        if (!slot || !floater) return
        const r = slot.getBoundingClientRect()
        floater.style.top = `${r.top}px`
        floater.style.left = `${r.left}px`
        floater.style.width = `${r.width}px`
        floater.style.height = `${r.height}px`
    })
    return (
        <Wrap>
            <AppFrame
                sidebarHidden={sidebarHidden}
                switcherActive={false}
                hasRail={true}
                railPinned={railPinned}
                topStrip={<TopStrip mac={false} dragRegion={false} />}
                sidebar={
                    <Sidebar
                        visible={!sidebarHidden}
                        graphCollapsed={false}
                        graphSlotRef={el => (slot = el)}
                        side={sidebarSide}
                        toolbar={
                            <>
                                <CommandButton icon="Search" label="Search" onClick={noop} />
                                <CommandButton icon="Inbox" label="Inbox" onClick={noop} />
                                <CommandButton icon="Settings" label="Settings" onClick={noop} />
                            </>
                        }
                        tree={
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
                        }
                    />
                }
                main={
                    <EditorPane banner={<></>} switcher={<></>} bodyRef={noop}>
                        <div style={{ padding: '24px 32px' }}>
                            <Text register="prose" size="lead" weight="medium">
                                Roadmap
                            </Text>
                            <Text register="prose" tone="muted">
                                Ship the shell layout, then the graph rework.
                            </Text>
                            <Text register="prose">
                                The sidebar, editor and tab rail share one grid; which side each sits on
                                is a pair of props.
                            </Text>
                        </div>
                    </EditorPane>
                }
                rail={
                    <TabRail
                        side={tabRailSide}
                        pinned={railPinned}
                        actions={
                            <>
                                <CommandButton icon="Plus" label="New tab" onClick={noop} />
                                <CommandButton icon="SquareTerminal" label="New terminal" onClick={noop} />
                            </>
                        }
                        edge={
                            <EdgeHandle
                                buttonSide={tabRailSide === 'right' ? 'left' : 'right'}
                                label="tab rail edge"
                                action={railPinned ? 'unpin tab rail' : 'pin tab rail'}
                                direction={tabRailSide === 'right' ? 'right' : 'left'}
                                onActivate={noop}
                            />
                        }
                    >
                        <TabRailRow
                            label="roadmap.md"
                            icon="File"
                            active={true}
                            pinned={false}
                            dragging={false}
                            renaming={false}
                            onActivate={noop}
                            onPointerDown={noop}
                            onAuxClick={noop}
                            onDblClick={noop}
                            onContextMenu={noop}
                            onClose={noop}
                            onUnpin={noop}
                            onCommitRename={noop}
                            onCancelRename={noop}
                        />
                        <TabRailRow
                            label="Knowledge Graph"
                            icon="Share2"
                            active={false}
                            pinned={true}
                            dragging={false}
                            renaming={false}
                            onActivate={noop}
                            onPointerDown={noop}
                            onAuxClick={noop}
                            onDblClick={noop}
                            onContextMenu={noop}
                            onClose={noop}
                            onUnpin={noop}
                            onCommitRename={noop}
                            onCancelRename={noop}
                        />
                    </TabRail>
                }
                floater={
                    <GraphFloater
                        docked={true}
                        dockSide={sidebarSide}
                        parked={sidebarHidden}
                        ref={el => (floater = el)}
                    >
                        <GraphView
                            fill
                            mini
                            visible={!sidebarHidden}
                            graph={sampleGraphData(8)}
                            onOpen={noop}
                            mode="2nd"
                            setMode={noop}
                            active={null}
                        />
                    </GraphFloater>
                }
                overlays={<></>}
                modals={<></>}
                statusBar={
                    <StatusBar
                        location={STATUS_LOCATION}
                        connected={true}
                        daemon="idle"
                        inboxCount={0}
                        onCopyLocation={noop}
                        onOpenInbox={noop}
                    />
                }
                sidebarEdge={
                    <EdgeHandle
                        buttonSide={sidebarSide === 'left' ? 'right' : 'left'}
                        label="sidebar edge"
                        action="hide sidebar"
                        direction={sidebarSide}
                        onActivate={noop}
                    />
                }
                {...p}
            />
        </Wrap>
    )
}

/** Only the status bar prints this, so `NoStatusBar` can assert it is gone. */
const STATUS_LOCATION = 'vault/projects/roadmap-status.md'

const meta = {
    title: 'Shell/AppFrame',
    component: AppFrame,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppFrame>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div style={{ height: '100vh' }}>{props.children as never}</div>
)

/** Resting state: sidebar visible, rail present, switcher inactive, rail unpinned. */
export const Default: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: true, railPinned: false }),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('[data-sidebar-side]') as HTMLElement
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('46px'),
        )
    },
}

/** `.layout[data-sidebar-hidden]` — collapses `--sidebar-w` to 0. The highest-consequence Trap-1
 *  instance in the plan: a missed hash here means the sidebar never hides. */
export const SidebarHidden: Story = {
    render: () => frame({ sidebarHidden: true, switcherActive: false, hasRail: true, railPinned: false }),
}

/** `.layout[data-switcher-active]` — both the sidebar and rail grid tracks collapse to 0 in lockstep
 *  with the Cmd+O quick switcher taking over the whole window. */
export const SwitcherActive: Story = {
    render: () => frame({ sidebarHidden: true, switcherActive: true, hasRail: true, railPinned: false }),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('[data-sidebar-side]') as HTMLElement
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('0px'),
        )
    },
}

/** `hasRail={false}` — a state the shipped app never actually reaches today (App.tsx always
 *  passes `true`), but the prop is real, so this is the only story proving the grid still
 *  degrades sanely without `.layout[data-has-rail]`. */
export const NoRail: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: false, railPinned: false }),
}

/** THE BUG THIS PINS (queue item 2, 2026-09-01, user-reported as "when the sidebar is permanently
 *  out, it covers the right side of the note"). Pinning widened an absolutely-positioned overlay
 *  from 46px to 232px while the grid kept reserving 46px, so 186px of opaque rail sat on top of the
 *  note.
 *  This story CANNOT stand alone: a stylesheet that reserved 232px unconditionally would satisfy it
 *  while breaking the hover flyout. `Default`'s 46px assertion above is the other half of the pair,
 *  and `SwitcherActive`'s 0px assertion is what proves the takeover still wins. */
export const RailPinned: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: true, railPinned: true }),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('[data-sidebar-side]') as HTMLElement
        expect(layout).toBeTruthy()
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('232px'),
        )
        // …and the reserved TRACK actually followed the variable. Asserting only the custom property
        // would pass against a `grid-template-columns` that had stopped referencing it.
        const cols = getComputedStyle(layout).gridTemplateColumns.split(' ')
        expect(parseFloat(cols[cols.length - 1])).toBeCloseTo(232, 0)
    },
}

/** Pinned AND taken over. `.layout[data-has-rail][data-rail-pinned]:not([data-switcher-active])` is written the way it
 *  is precisely so this case has one answer regardless of rule order; without a story it would be
 *  the state nobody checked. */
export const RailPinnedUnderSwitcher: Story = {
    render: () => frame({ sidebarHidden: true, switcherActive: true, hasRail: true, railPinned: true }),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('[data-sidebar-side]') as HTMLElement
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('0px'),
        )
    },
}

/** Sidebar against the window's right edge, rail on the right too: `editor | rail | sidebar`. */
export const SidebarRight: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: true, railPinned: false, sidebarSide: 'right', tabRailSide: 'right' }),
    play: async ({ canvasElement }) => {
        const sidebar = canvasElement.querySelector('[data-shell-cell="sidebar"]') as HTMLElement
        const main = canvasElement.querySelector('[data-shell-cell="main"]') as HTMLElement
        await waitFor(() =>
            expect(sidebar.getBoundingClientRect().left).toBeGreaterThan(main.getBoundingClientRect().left),
        )
    },
}

/** Sidebar on the right, rail on the left: `rail | editor | sidebar`. */
export const RailLeft: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: true, railPinned: false, sidebarSide: 'right', tabRailSide: 'left' }),
    play: async ({ canvasElement }) => {
        const rail = canvasElement.querySelector('[data-shell-cell="rail"]') as HTMLElement
        const main = canvasElement.querySelector('[data-shell-cell="main"]') as HTMLElement
        await waitFor(() =>
            expect(rail.getBoundingClientRect().left).toBeLessThan(main.getBoundingClientRect().left),
        )
    },
}

/** Both on the left: `sidebar | rail | editor` — the sidebar outermost. */
export const BothLeft: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: true, railPinned: false, sidebarSide: 'left', tabRailSide: 'left' }),
    play: async ({ canvasElement }) => {
        const rect = (c: string) =>
            (canvasElement.querySelector(`[data-shell-cell="${c}"]`) as HTMLElement).getBoundingClientRect()
        const edgeEl = canvasElement.querySelector('[data-sidebar-side] > [data-side]') as HTMLElement
        await waitFor(() => {
        expect(rect('sidebar').right).toBeCloseTo(rect('rail').left, 0)
        expect(rect('rail').right).toBeCloseTo(rect('main').left, 0)
        expect(edgeEl.getBoundingClientRect().left).toBeCloseTo(rect('sidebar').right, 0)
        })
        // The strip must be the topmost thing at its own pixels, not buried under the rail.
        const e = edgeEl.getBoundingClientRect()
        expect(edgeEl.contains(document.elementFromPoint(e.left + 2, e.top + e.height / 2))).toBe(true)
    },
}

/** Both on the right: `editor | rail | sidebar` — the mirror image. */
export const BothRight: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: true, railPinned: false, sidebarSide: 'right', tabRailSide: 'right' }),
    play: async ({ canvasElement }) => {
        const rect = (c: string) =>
            (canvasElement.querySelector(`[data-shell-cell="${c}"]`) as HTMLElement).getBoundingClientRect()
        const edgeEl = canvasElement.querySelector('[data-sidebar-side] > [data-side]') as HTMLElement
        await waitFor(() => {
        expect(rect('main').right).toBeCloseTo(rect('rail').left, 0)
        expect(rect('rail').right).toBeCloseTo(rect('sidebar').left, 0)
        expect(edgeEl.getBoundingClientRect().right).toBeCloseTo(rect('sidebar').left, 0)
        })
        // The strip must be the topmost thing at its own pixels, not buried under the rail.
        const e = edgeEl.getBoundingClientRect()
        expect(edgeEl.contains(document.elementFromPoint(e.right - 2, e.top + e.height / 2))).toBe(true)
    },
}

/** `statusBarVisible={false}` — no bottom bar; the grid reaches the window's bottom edge. */
export const NoStatusBar: Story = {
    render: () => frame({ sidebarHidden: false, switcherActive: false, hasRail: true, railPinned: false, statusBarVisible: false }),
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).not.toContain(STATUS_LOCATION)
    },
}
