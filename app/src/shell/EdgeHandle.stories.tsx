// Visual spec for <EdgeHandle> — the grab strip on the left sidebar's right line and the tab rail's
// left line. Every story holds REAL state: the strip resizes a real panel when dragged and runs a
// real toggle when clicked, so a story handed over to try behaves the way the app does (a no-op
// callback would read as broken). The panels are stand-ins drawn from the shell's own tokens
// (`--rail`, `--border-soft`); the width bounds are the schema's, through edgeResize.ts.
//
// `:hover` cannot be posed from a story (it follows the physical pointer), so the `*Button` stories
// FOCUS the strip in `play` — the chevron springs out on `:focus` exactly as it does on `:hover`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, type JSX } from 'solid-js'
import { expect } from 'storybook/test'
import EdgeHandle from './EdgeHandle'
import { dragWidth } from '../edgeResize'
import Text from '../ui/Text'

const COLLAPSED_RAIL = 46

const panel = (width: string, side: 'left' | 'right', label: string): JSX.Element => (
    <div
        style={{
            width,
            'flex-shrink': 0,
            background: 'var(--rail)',
            [side === 'left' ? 'border-right' : 'border-left']: '1px solid var(--border-soft)',
            overflow: 'hidden',
            transition: 'width 0.26s var(--ease)',
            padding: width === '0px' ? '0' : 'var(--sp-5)',
            'box-sizing': 'border-box',
        }}
    >
        <Text>{label}</Text>
    </div>
)

const editor = (children: JSX.Element, edgeSide: 'left' | 'right') => (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: 'var(--sp-6)' }}>
        <Text register="prose">
            The editor. Hover the panel's line and a chevron springs out at its middle — drag the
            line to resize, click it (or the chevron) to toggle.
        </Text>
        <div
            style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                [edgeSide]: 0,
                width: '6px',
            }}
        >
            {children}
        </div>
    </div>
)

const frame = (children: JSX.Element) => (
    <div style={{ display: 'flex', height: '420px', background: 'var(--bg)' }}>{children}</div>
)

function SidebarDemo(props: { hidden?: boolean }) {
    const [width, setWidth] = createSignal(266)
    // `props.hidden` seeds the initial state only — the story owns it from there
    const [visible, setVisible] = createSignal(!props.hidden)
    let start = 0
    return frame(
        <>
            {panel(visible() ? `${width()}px` : '0px', 'left', visible() ? `sidebar // ${width()}px` : '')}
            {editor(
                <EdgeHandle
                    buttonSide="right"
                    label="sidebar edge"
                    action={visible() ? 'hide sidebar' : 'show sidebar'}
                    direction={visible() ? 'left' : 'right'}
                    combo="Alt+S"
                    resizable={visible()}
                    reveal={!visible()}
                    onResizeStart={() => (start = width())}
                    onResize={dx => setWidth(dragWidth('sidebarWidth', start, dx, 1))}
                    onActivate={() => setVisible(v => !v)}
                />,
                'left',
            )}
        </>,
    )
}

function RailDemo() {
    const [width, setWidth] = createSignal(232)
    const [pinned, setPinned] = createSignal(false)
    let start = 0
    return frame(
        <>
            {editor(
                <EdgeHandle
                    buttonSide="left"
                    label="tab rail edge"
                    action={pinned() ? 'unpin tab rail' : 'pin tab rail'}
                    direction={pinned() ? 'right' : 'left'}
                    combo="Alt+Shift+S"
                    onResizeStart={() => (start = width())}
                    onResize={dx => setWidth(dragWidth('tabRailWidth', start, dx, -1))}
                    onActivate={() => setPinned(v => !v)}
                />,
                'right',
            )}
            {panel(
                `${pinned() ? width() : COLLAPSED_RAIL}px`,
                'right',
                pinned() ? `rail // ${width()}px` : '',
            )}
        </>,
    )
}

/** A RIGHT sidebar: panel on the window's right, strip on its left (editor) line, chevron out LEFTWARD. */
function SidebarRightDemo(props: { hidden?: boolean }) {
    const [width, setWidth] = createSignal(266)
    const [visible, setVisible] = createSignal(!props.hidden)
    let start = 0
    return frame(
        <>
            {editor(
                <EdgeHandle
                    buttonSide="left"
                    label="sidebar edge"
                    action={visible() ? 'hide sidebar' : 'show sidebar'}
                    direction={visible() ? 'right' : 'left'}
                    combo="Alt+S"
                    resizable={visible()}
                    reveal={!visible()}
                    onResizeStart={() => (start = width())}
                    onResize={dx => setWidth(dragWidth('sidebarWidth', start, dx, -1))}
                    onActivate={() => setVisible(v => !v)}
                />,
                'right',
            )}
            {panel(
                visible() ? `${width()}px` : '0px',
                'right',
                visible() ? `sidebar // ${width()}px` : '',
            )}
        </>,
    )
}

/** A LEFT tab rail: rail on the window's left, strip on its right line, chevron out RIGHTWARD. */
function RailLeftDemo() {
    const [width, setWidth] = createSignal(232)
    const [pinned, setPinned] = createSignal(false)
    let start = 0
    return frame(
        <>
            {panel(
                `${pinned() ? width() : COLLAPSED_RAIL}px`,
                'left',
                pinned() ? `rail // ${width()}px` : '',
            )}
            {editor(
                <EdgeHandle
                    buttonSide="right"
                    label="tab rail edge"
                    action={pinned() ? 'unpin tab rail' : 'pin tab rail'}
                    direction={pinned() ? 'left' : 'right'}
                    combo="Alt+Shift+S"
                    onResizeStart={() => (start = width())}
                    onResize={dx => setWidth(dragWidth('tabRailWidth', start, dx, 1))}
                    onActivate={() => setPinned(v => !v)}
                />,
                'left',
            )}
        </>,
    )
}

const meta = {
    title: 'Shell/EdgeHandle',
    component: EdgeHandle,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EdgeHandle>

export default meta
type Story = StoryObj<typeof meta>

const focusEdge = async (canvasElement: HTMLElement, minWidth = 0) => {
    const edge = canvasElement.querySelector<HTMLElement>('[data-edge-handle]')
    await expect(edge).not.toBeNull()
    await expect(edge!.getBoundingClientRect().width).toBeGreaterThanOrEqual(minWidth)
    edge!.focus()
    const hint = canvasElement.querySelector<HTMLElement>('[data-edge-button]')!
    // The chevron springs in after a 0.12s beat — poll for it rather than sample the transition's start.
    await new Promise<void>(resolve => {
        const tick = () =>
            getComputedStyle(hint).visibility === 'visible' ? resolve() : requestAnimationFrame(tick)
        tick()
    })
    await expect(getComputedStyle(hint).visibility).toBe('visible')
}

/** The sidebar's line at rest: no highlight, no hint — the panel's own 1px border is the line. */
export const Sidebar: Story = { render: () => <SidebarDemo /> }

/** Hovered (posed by focus): the line lights in --accent and a `‹` chevron springs out at its
 *  vertical centre, over the editor — click it to hide the sidebar (tooltip: `hide sidebar (⌥S)`). */
export const SidebarButton: Story = {
    render: () => <SidebarDemo />,
    play: async ({ canvasElement }) => focusEdge(canvasElement),
}

/** Hidden sidebar: its line is the window's left edge, widened to a 24px reveal zone so reaching
 *  toward the left of the screen brings out `›` — show it. */
export const SidebarHiddenButton: Story = {
    render: () => <SidebarDemo hidden />,
    play: async ({ canvasElement }) => focusEdge(canvasElement, 24),
}

/** The rail's line, mirrored: the chevron springs out LEFTWARD, `‹` — pin the rail open. */
export const RailButton: Story = {
    render: () => <RailDemo />,
    play: async ({ canvasElement }) => focusEdge(canvasElement),
}

/** A right sidebar at rest: the panel's 1px line is on its left; no highlight, no hint. */
export const SidebarRight: Story = { render: () => <SidebarRightDemo /> }

/** Right sidebar, hovered (posed by focus): the chevron springs out LEFTWARD over the editor,
 *  pointing `right` — hide it toward the window's right edge. */
export const SidebarRightButton: Story = {
    render: () => <SidebarRightDemo />,
    play: async ({ canvasElement }) => focusEdge(canvasElement),
}

/** Hidden right sidebar: its line is the window's RIGHT edge, the 24px reveal zone widens leftward
 *  from it, and the chevron pops out leftward pointing `left` — show it. */
export const SidebarRightHiddenButton: Story = {
    render: () => <SidebarRightDemo hidden />,
    play: async ({ canvasElement }) => {
        await focusEdge(canvasElement, 24)
        const edge = canvasElement.querySelector<HTMLElement>('[data-edge-handle]')!
        const slot = edge.parentElement!.getBoundingClientRect()
        const r = edge.getBoundingClientRect()
        await expect(Math.abs(r.right - slot.right)).toBeLessThan(1)
    },
}

/** A left rail's line, mirrored from `RailButton`: the chevron springs out RIGHTWARD, `›` — pin it. */
export const RailLeftButton: Story = {
    render: () => <RailLeftDemo />,
    play: async ({ canvasElement }) => focusEdge(canvasElement),
}
