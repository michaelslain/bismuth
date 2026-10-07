// Visual spec for <AsciiMeter> — the system's only progress indicator (its chart is
// AsciiChart.stories.tsx). See bismuth-design/ascii/design-system/components/ascii/
// AsciiMeter.prompt.md for intent (index confidence, token budget, edge growth).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect } from 'storybook/test'
import AsciiMeter from './AsciiMeter'
import { Row } from '../_storyKit'

const meta = {
    title: 'UI/Ascii/AsciiMeter',
    component: AsciiMeter,
    parameters: { layout: 'centered' },
    argTypes: {
        value: { control: { type: 'range', min: -0.2, max: 1.2, step: 0.05 } },
        width: { control: 'number' },
        label: { control: 'text' },
        labelWidth: { control: 'number' },
        suffix: { control: 'text' },
    },
    args: {
        value: 0.82,
        label: 'index',
        suffix: '82%',
    },
} satisfies Meta<typeof AsciiMeter>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single meter. */
export const Playground: Story = {}

/** Boundary values: empty, full, mid, and out-of-range (clamped). `labelWidth` pads the labels to
 *  one column so every `[` lines up — nothing hand-pads a label. */
export const Boundaries: Story = {
    render: () => (
        <Row label="0 / 0.5 / 1 / out-of-range" column gap="4px">
            <AsciiMeter value={0} label="empty" labelWidth={5} />
            <AsciiMeter value={0.5} label="mid" labelWidth={5} />
            <AsciiMeter value={1} label="full" labelWidth={5} />
            <AsciiMeter value={1.4} label="over" labelWidth={5} suffix="clamped" />
            <AsciiMeter value={-0.4} label="under" labelWidth={5} suffix="clamped" />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const meters = [...canvasElement.querySelectorAll<HTMLElement>('span')].filter(el =>
            el.textContent?.includes('['),
        )
        const outer = meters.filter(el => !meters.some(o => o !== el && o.contains(el)))
        expect(outer.length).toBe(5)
        // every meter's `[` sits in one column: the labels are padded by labelWidth, not by hand
        const bracketX = outer.map(el => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const i = n.textContent!.indexOf('[')
                if (i < 0) continue
                const range = document.createRange()
                range.setStart(n, i)
                range.setEnd(n, i + 1)
                return range.getBoundingClientRect().left
            }
            throw new Error('no `[` in a meter')
        })
        for (const x of bracketX) expect(Math.abs(x - bracketX[0]!)).toBeLessThan(0.5)
    },
}

/** A small-but-real value never reads as zero: 0.04 on a 10-cell meter draws ONE `#`, where
 *  rounding drew none and `[..........]` looked empty. Only an actual 0 is empty. */
export const SmallValueFloorsAtOneCell: Story = {
    render: () => (
        <Row column gap="4px">
            <AsciiMeter value={0} label="zero" labelWidth={5} />
            <AsciiMeter value={0.04} label="tiny" labelWidth={5} />
            <AsciiMeter value={0.5} label="half" labelWidth={5} />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const text = canvasElement.textContent ?? ''
        expect(text).toContain('zero   [..........]')
        expect(text, 'a value of 0.04 draws one cell, not none').toContain('tiny   [#.........]')
        expect(text).toContain('half   [#####.....]')
    },
}

/** Different widths and an explicit color, no label/suffix. */
export const WidthAndColor: Story = {
    render: () => (
        <Row column gap="4px">
            <AsciiMeter value={0.6} width={6} />
            <AsciiMeter value={0.6} width={20} />
            <AsciiMeter value={0.6} width={20} color="var(--graph-0)" />
        </Row>
    ),
}

/** Live-updating meter. */
export const Animated: Story = {
    render: () => {
        const [value, setValue] = createSignal(0)
        const id = setInterval(
            () => setValue(v => (v >= 1 ? 0 : v + 0.05)),
            200,
        )
        setTimeout(() => clearInterval(id), 20_000)
        return (
            <AsciiMeter
                value={value()}
                label="sync"
                suffix={`${Math.round(value() * 100)}%`}
            />
        )
    },
}
