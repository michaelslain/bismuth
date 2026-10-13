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
import IconButton from '../ui/IconButton'

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
                    panel="sidebar"
                    edge="left"
                    open={visible()}
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
                    panel="tab rail"
                    edge="right"
                    open={pinned()}
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
                    panel="sidebar"
                    edge="right"
                    open={visible()}
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
                    panel="tab rail"
                    edge="left"
                    open={pinned()}
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

/** The editor's left gutter with a control in it, under a HIDDEN sidebar's reveal zone: an
 *  `IconButton` placed exactly as an image/PDF's frontmatter fold chevron sits (centred 20px from
 *  the pane edge, preview/CompanionFrontmatter.module.css). Clicking it folds; the sidebar stays
 *  hidden. */
function GutterControlDemo() {
    const [visible, setVisible] = createSignal(false)
    const [folded, setFolded] = createSignal(false)
    return frame(
        <>
            {panel(visible() ? '266px' : '0px', 'left', visible() ? 'sidebar' : '')}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'relative', padding: 'var(--sp-4) 40px' }}>
                    <IconButton
                        data-testid="gutter-chevron"
                        style={{
                            position: 'absolute',
                            left: '20px',
                            top: '18px',
                            transform: 'translate(-50%, -50%)',
                        }}
                        icon={folded() ? 'ChevronRight' : 'ChevronDown'}
                        label={folded() ? 'unfold frontmatter' : 'fold frontmatter'}
                        onClick={() => setFolded(v => !v)}
                    />
                    <Text register="prose">{folded() ? '--- tags: 2' : '---'}</Text>
                </div>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '6px' }}>
                    <EdgeHandle
                        panel="sidebar"
                        edge="left"
                        open={visible()}
                        combo="Alt+S"
                        resizable={visible()}
                        reveal={!visible()}
                        onActivate={() => setVisible(v => !v)}
                    />
                </div>
            </div>
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

/** Hidden sidebar: its line is the window's left edge, widened to an 8px reveal zone so reaching
 *  toward the left of the screen brings out `›` — show it. */
export const SidebarHiddenButton: Story = {
    render: () => <SidebarDemo hidden />,
    play: async ({ canvasElement }) => focusEdge(canvasElement, 8),
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

/** Hidden right sidebar: its line is the window's RIGHT edge, the 8px reveal zone widens leftward
 *  from it, and the chevron pops out leftward pointing `left` — show it. */
export const SidebarRightHiddenButton: Story = {
    render: () => <SidebarRightDemo hidden />,
    play: async ({ canvasElement }) => {
        await focusEdge(canvasElement, 8)
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

/** Hidden sidebar over a gutter control: the reveal zone ends before the editor's gutter controls
 *  begin, so every point of the fold chevron is the chevron's — a click there folds and never
 *  opens the sidebar. */
export const SidebarHiddenGutterControl: Story = {
    render: () => <GutterControlDemo />,
    play: async ({ canvasElement }) => {
        const chevron = canvasElement.querySelector<HTMLElement>('[data-testid="gutter-chevron"]')!
        const edge = canvasElement.querySelector<HTMLElement>('[data-edge-handle]')!
        const c = chevron.getBoundingClientRect()
        await expect(edge.getBoundingClientRect().right).toBeLessThanOrEqual(c.left)
        for (const x of [c.left + 1, c.left + c.width / 2, c.right - 1]) {
            const hit = document.elementFromPoint(x, c.top + c.height / 2)
            await expect(chevron.contains(hit)).toBe(true)
        }
        chevron.click()
        await expect(chevron.getAttribute('aria-label')).toBe('unfold frontmatter')
        const toggle = canvasElement.querySelector('[data-edge-button] button')!
        await expect(toggle.getAttribute('aria-label')).toBe('show sidebar (⌥S)')
    },
}

function ResizeOnlyDemo() {
    const [width, setWidth] = createSignal(232)
    let start = 0
    return frame(
        <>
            {editor(
                <EdgeHandle
                    panel="scratch"
                    edge="right"
                    open
                    onResizeStart={() => (start = width())}
                    onResize={dx => setWidth(dragWidth('tabRailWidth', start, dx, -1))}
                />,
                'right',
            )}
            {panel(`${width()}px`, 'right', `scratch // ${width()}px`)}
        </>,
    )
}

/** No `onActivate` (an image's scratch line): focused or hovered, the line lights but no chevron
 *  springs out, and a click does nothing — the strip only resizes. */
export const ResizeOnly: Story = {
    render: () => <ResizeOnlyDemo />,
    play: async ({ canvasElement }) => {
        const edge = canvasElement.querySelector<HTMLElement>('[data-edge-handle]')!
        edge.focus()
        await expect(edge.querySelector('[data-edge-button]')).toBeNull()
        await expect(edge.getAttribute('aria-label')).toBe('scratch edge')
    },
}
