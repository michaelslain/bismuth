// Visual spec for <SegmentedToggle> — a row of mutually-exclusive buttons (the active
// one "selected", the rest "unselected"). Generic over the option id type; the canonical
// selected/unselected consumer (graph mode, calendar view switcher, Bases view tabs).
//
// Props: options (id + label + optional title), value, onChange, size?, class?,
// segmentClass?, look? ('bracket' default | 'segment').
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { createSignal } from 'solid-js'
import { SegmentedToggle } from './SegmentedToggle'
import { Icon } from '../icons/Icon'

const meta = {
    title: 'UI/SegmentedToggle',
    parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A simple two-way switch (2D/3D), the graph view-mode shape. Default `look="bracket"`. */
export const TwoWay: Story = {
    render: () => {
        const [v, setV] = createSignal<'2d' | '3d'>('2d')
        return (
            <SegmentedToggle
                value={v()}
                onChange={setV}
                size="sm"
                options={[
                    { id: '2d', label: '2d' },
                    { id: '3d', label: '3d' },
                ]}
            />
        )
    },
}

/** Several labelled segments (a Bases view-tab row). `play` proves the keyboard path on the
 *  default bracket look: Tab reaches the second option, Space toggles it, the newly-selected
 *  option picks up `aria-pressed` + bold weight, and the wrapper's sibling gap is real. */
export const MultiWay: Story = {
    render: () => {
        const [v, setV] = createSignal('table')
        return (
            <SegmentedToggle
                value={v()}
                onChange={setV}
                options={[
                    { id: 'table', label: 'table' },
                    { id: 'cards', label: 'cards' },
                    { id: 'kanban', label: 'kanban' },
                    { id: 'list', label: 'list' },
                ]}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await userEvent.tab()
        await userEvent.tab()
        const second = document.activeElement as HTMLElement
        expect(second.textContent).toContain('cards')
        await userEvent.keyboard('[Space]')
        expect(second.getAttribute('aria-pressed')).toBe('true')
        expect(getComputedStyle(second).fontWeight).toBe('600')
        const wrap = canvasElement.querySelector(
            '[data-look="bracket"]',
        ) as HTMLElement
        expect(getComputedStyle(wrap).columnGap).not.toBe('0px')
    },
}

/** Segments with a leading icon + short label (the graph-mode switcher shape). */
export const WithIcons: Story = {
    render: () => {
        const [v, setV] = createSignal('2nd')
        return (
            <SegmentedToggle
                value={v()}
                onChange={setV}
                size="sm"
                options={[
                    {
                        id: '2nd',
                        title: '2nd brain',
                        label: (
                            <>
                                <Icon value="BookOpen" size={14} />
                                <span class="btn-label">2nd</span>
                            </>
                        ),
                    },
                    {
                        id: '3rd',
                        title: '3rd brain',
                        label: (
                            <>
                                <Icon value="Brain" size={14} />
                                <span class="btn-label">3rd</span>
                            </>
                        ),
                    },
                    {
                        id: 'both',
                        title: 'Both brains',
                        label: (
                            <>
                                <Icon value="Blend" size={14} />
                                <span class="btn-label">both</span>
                            </>
                        ),
                    },
                ]}
            />
        )
    },
}

/** `look="segment"` — today's butted boxes, uppercase, sized. The drawing toolbar's icon-only
 *  tool groups are the one remaining caller of this look. */
export const SegmentLook: Story = {
    render: () => {
        const [v, setV] = createSignal('pen')
        return (
            <SegmentedToggle
                value={v()}
                onChange={setV}
                look="segment"
                size="sm"
                options={[
                    {
                        id: 'pen',
                        title: 'Pen',
                        ariaLabel: 'Pen',
                        label: <Icon value="Pen" size={14} />,
                    },
                    {
                        id: 'eraser',
                        title: 'Eraser',
                        ariaLabel: 'Eraser',
                        label: <Icon value="Eraser" size={14} />,
                    },
                    {
                        id: 'highlighter',
                        title: 'Highlighter',
                        ariaLabel: 'Highlighter',
                        label: <Icon value="Highlighter" size={14} />,
                    },
                ]}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const wrap = canvasElement.querySelector(
            '[data-look="segment"]',
        ) as HTMLElement
        expect(wrap).not.toBeNull()
        const pen = canvasElement.querySelector<HTMLElement>(
            '[aria-label="Pen"]',
        )!
        expect(pen.classList.contains('btn--segment')).toBe(true)
        expect(pen.hasAttribute('aria-pressed')).toBe(false)
    },
}

/** No selected segment (undo/redo shape) plus a per-option `class` + `ariaLabel` — the
 *  drawing toolbar's zoom group shape: two icon commands and a fixed-width percent readout,
 *  none of them ever "selected". */
export const NoSelectionWithOptionExtras: Story = {
    render: () => {
        const [pct, setPct] = createSignal(100)
        return (
            <SegmentedToggle
                value={undefined}
                onChange={id => {
                    if (id === 'out') setPct(p => p - 5)
                    else if (id === 'in') setPct(p => p + 5)
                }}
                options={[
                    {
                        id: 'out' as const,
                        label: <Icon value="ZoomOut" size={17} />,
                        title: 'Zoom out',
                        ariaLabel: 'Zoom out',
                    },
                    {
                        id: 'reset' as const,
                        label: `${pct()}%`,
                        title: 'Reset zoom',
                        ariaLabel: 'Reset zoom',
                        class: 'fixed-width-demo',
                    },
                    {
                        id: 'in' as const,
                        label: <Icon value="ZoomIn" size={17} />,
                        title: 'Zoom in',
                        ariaLabel: 'Zoom in',
                    },
                ]}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const out = canvasElement.querySelector<HTMLElement>(
            '[aria-label="Zoom out"]',
        )!
        const reset = canvasElement.querySelector<HTMLElement>(
            '[aria-label="Reset zoom"]',
        )!
        expect(out).not.toBeNull()
        expect(reset.classList.contains('fixed-width-demo')).toBe(true)
        // No segment is ever "selected" — this group has no active member.
        expect(out.classList.contains('btn--selected')).toBe(false)
    },
}

/** All three sizes side by side. */
export const Sizes: Story = {
    render: () => {
        const [a, setA] = createSignal('one')
        const [b, setB] = createSignal('one')
        const [c, setC] = createSignal('one')
        const opts = [
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
        ]
        return (
            <div
                style={{
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '14px',
                }}
            >
                <SegmentedToggle
                    value={a()}
                    onChange={setA}
                    size="sm"
                    options={opts}
                />
                <SegmentedToggle
                    value={b()}
                    onChange={setB}
                    size="md"
                    options={opts}
                />
                <SegmentedToggle
                    value={c()}
                    onChange={setC}
                    size="lg"
                    options={opts}
                />
            </div>
        )
    },
}
