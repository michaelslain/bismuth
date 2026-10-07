// Visual spec for <StatusDot> + <StatusText> — the colored-dot status renderer (no
// pill). The category palette (Reading=teal / To Read=blue / Finished=green /
// Abandoned=rose) lives in STATUS_COLOR and is shared by Table/List/Kanban.
//
// StatusDot: color? (explicit override) or status? (looked up via statusColor, faint
// fallback for unknown strings). StatusText: status (required) — dot + label, both
// tinted.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import StatusDot, { STATUS_COLOR, StatusText } from './StatusDot'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/StatusDot',
    component: StatusDot,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof StatusDot>

export default meta
type Story = StoryObj<typeof meta>

const PAINTED = 'rgba(0, 0, 0, 0)'
/** Every dot in the canvas has a real box and a real fill. */
function expectDotsPaint(root: HTMLElement, n: number): void {
    const dots = [...root.querySelectorAll('span[data-size]')]
    expect(dots.length).toBe(n)
    for (const d of dots) {
        expect(d.getBoundingClientRect().width).toBeGreaterThan(0)
        expect(getComputedStyle(d).backgroundColor).not.toBe(PAINTED)
    }
}

const STATUSES = ['Reading', 'To Read', 'Finished', 'Abandoned', 'Todo', 'Doing', 'In progress']

/** Every known status, dot only. */
export const Dots: Story = {
    render: () => (
        <Row label="dot only" column gap="10px">
            {STATUSES.map(s => (
                <div
                    style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                    }}
                >
                    <StatusDot status={s} />
                    <span
                        style={{
                            'font-family': 'var(--ui-font-stack)',
                            'font-size': 'var(--fs-body)',
                            color: 'var(--fg)',
                        }}
                    >
                        {s}
                    </span>
                </div>
            ))}
        </Row>
    ),
    play: ({ canvasElement }) => expectDotsPaint(canvasElement, STATUSES.length),
}

/** The four dot sizes: xs 5px (an inline alert), sm 6px (default), md 8px (kanban column header),
 *  lg 10px (a picker swatch). `play` measures each box — a dot with a width/height but no `display`
 *  (chat's old colour dot) measures 0x0 and paints nothing, so a rect is the real assertion. */
export const Sizes: Story = {
    render: () => (
        <Row label="xs // sm // md // lg" gap="10px">
            <StatusDot status="Reading" size="xs" />
            <StatusDot status="Reading" size="sm" />
            <StatusDot status="Reading" size="md" />
            <StatusDot status="Reading" size="lg" />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const dots = [...canvasElement.querySelectorAll('span[data-size]')]
        expect(dots.length).toBe(4)
        const px = dots.map(d => Math.round(d.getBoundingClientRect().width))
        expect(px).toEqual([5, 6, 8, 10])
        for (const d of dots) {
            expect(Math.round(d.getBoundingClientRect().height)).toBe(
                Math.round(d.getBoundingClientRect().width),
            )
            expect(getComputedStyle(d).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        }
    },
}

/** `ring` (an inset hairline so a dark fill still reads), `glow` (the accent halo), both, and the
 *  hollow ring — a transparent dot whose ring IS the mark (chat's "no colour" row). `play` asserts
 *  each paints a box-shadow and the plain dot paints none. */
export const RingAndGlow: Story = {
    render: () => (
        <Row label="plain // ring // glow // both // hollow" gap="12px">
            <StatusDot size="lg" status="Reading" />
            <StatusDot size="lg" status="Reading" ring />
            <StatusDot size="lg" status="Reading" glow />
            <StatusDot size="lg" status="Reading" ring glow />
            <StatusDot size="lg" color="transparent" ring />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const dots = [...canvasElement.querySelectorAll('span[data-size]')]
        const shadow = (i: number) => getComputedStyle(dots[i]!).boxShadow
        expect(dots.length).toBe(5)
        // a no-op shadow is `rgba(0, 0, 0, 0) 0px 0px 0px 0px`: nothing is drawn
        const drawn = (v: string) => v !== 'none' && !/^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,? ?)+$/.test(v)
        expect(drawn(shadow(0))).toBe(false)
        for (const i of [1, 2, 3, 4]) expect(drawn(shadow(i))).toBe(true)
        // the hollow dot has no fill but still occupies its 10px box
        expect(getComputedStyle(dots[4]!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(Math.round(dots[4]!.getBoundingClientRect().width)).toBe(10)
    },
}

/** The ONE status→colour table, now carrying the task-style statuses: todo is blue like "to read",
 *  doing / in progress are teal like "reading". `play` asserts every status paints a real colour and
 *  that todo / doing / in progress are in the table rather than falling to the faint grey. */
export const StatusColors: Story = {
    render: () => (
        <Row label="every status in STATUS_COLOR" column gap="10px">
            {Object.keys(STATUS_COLOR).map(k => (
                <StatusText status={k} />
            ))}
        </Row>
    ),
    play: async () => {
        for (const k of ['todo', 'doing', 'in progress'])
            expect(STATUS_COLOR[k]).toBeTruthy()
        expect(STATUS_COLOR['todo']).toBe(STATUS_COLOR['to read'])
        expect(STATUS_COLOR['doing']).toBe(STATUS_COLOR['reading'])
        expect(STATUS_COLOR['in progress']).toBe(STATUS_COLOR['reading'])
    },
}

/** An unrecognized status string falls back to the faint dot color. */
export const UnknownStatus: Story = {
    render: () => (
        <Row label="unknown status // faint" gap="10px">
            <StatusDot status="Someday" />
        </Row>
    ),
    play: ({ canvasElement }) => expectDotsPaint(canvasElement, 1),
}

/** An explicit color override (bypasses the status lookup entirely). */
export const ExplicitColor: Story = {
    render: () => (
        <Row label="explicit colour // rose" gap="10px">
            <StatusDot color="var(--rose)" />
        </Row>
    ),
    play: ({ canvasElement }) => expectDotsPaint(canvasElement, 1),
}

/** <StatusText> — dot + label together, both tinted to the status color. */
export const TextVariant: Story = {
    render: () => (
        <Row label="dot + label" column gap="10px">
            {STATUSES.map(s => (
                <StatusText status={s} />
            ))}
        </Row>
    ),
    play: ({ canvasElement }) => expectDotsPaint(canvasElement, STATUSES.length),
}
