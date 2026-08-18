// Visual spec for <AsciiMeter> + <AsciiChart> — the system's only progress
// indicator and its only chart. See design/ascii/design-system/components/ascii/
// AsciiMeter.prompt.md for intent (index confidence, token budget, edge growth).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { AsciiChart, AsciiMeter } from './AsciiMeter'
import { Row } from '../_storyKit'

const meta = {
    title: 'UI/Ascii/AsciiMeter',
    component: AsciiMeter,
    parameters: { layout: 'centered' },
    argTypes: {
        value: { control: { type: 'range', min: -0.2, max: 1.2, step: 0.05 } },
        width: { control: 'number' },
        label: { control: 'text' },
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

/** Boundary values: empty, full, mid, and out-of-range (clamped). */
export const Boundaries: Story = {
    render: () => (
        <Row label="0 / 0.5 / 1 / out-of-range" column gap="4px">
            <AsciiMeter value={0} label="empty" />
            <AsciiMeter value={0.5} label="mid  " />
            <AsciiMeter value={1} label="full " />
            <AsciiMeter value={1.4} label="over " suffix="clamped" />
            <AsciiMeter value={-0.4} label="under" suffix="clamped" />
        </Row>
    ),
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

/** A row of typed bars — the system's only chart. */
export const Chart: Story = {
    render: () => (
        <AsciiChart
            series={[
                { label: 'attention', value: 118, color: 'var(--graph-0)' },
                { label: 'recall', value: 40, color: 'var(--graph-1)' },
                { label: 'drift', value: 3 },
            ]}
        />
    ),
}

/** Single-item and empty-series edge cases. */
export const ChartEdgeCases: Story = {
    render: () => (
        <Row column gap="12px">
            <AsciiChart series={[{ label: 'solo', value: 7 }]} />
            <AsciiChart series={[]} />
        </Row>
    ),
}
