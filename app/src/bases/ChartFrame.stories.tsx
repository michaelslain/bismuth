// Visual spec for <ChartFrame> — the outer padding/scroll/empty-state chrome shared by
// Bar/Heatmap/Line/Stat views, extracted out of the old bases/Charts.module.css (imported
// directly by all four). See ChartFrame.tsx for why.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChartFrame from './ChartFrame'
import ChartReadout from './ChartReadout'
import ChartDrill from './ChartDrill'
import { EMPTY_FILE, type Row } from '../../../core/src/bases/types'

const narrowDecorator = (Story: () => JSX.Element) => (
    <div style={{ width: '300px' }}>
        <Story />
    </div>
)

function fileRow(name: string): Row {
    return {
        file: { ...EMPTY_FILE, name, basename: name, path: `${name}.md` },
        note: {},
        formula: {},
    }
}

const meta = {
    title: 'Bases/ChartFrame',
    component: ChartFrame,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChartFrame>

export default meta
type Story = StoryObj<typeof meta>

/** Populated: renders its children as-is inside the padded/scrollable frame. */
export const WithContent: Story = {
    args: {
        empty: false,
        emptyMessage: 'No data to chart.',
        children: <div>chart content goes here</div>,
    },
}

/** Empty: `emptyMessage` renders centered instead of `children`. */
export const Empty: Story = {
    args: {
        empty: true,
        emptyMessage: 'No data to chart.',
        children: <div>chart content goes here</div>,
    },
}

/** All four slots at once: readout above the body, footer + drill below. */
export const WithReadoutFooterDrill: Story = {
    args: {
        empty: false,
        emptyMessage: 'No data to chart.',
        readout: <ChartReadout parts={['Jul 20', '3', '2 notes']} active />,
        children: <div>chart content goes here</div>,
        footer: <div>y(t) = ...</div>,
        drill: (
            <ChartDrill
                title="Jul 20"
                rows={[fileRow('Morning pages'), fileRow('Standup notes')]}
                onOpen={() => {}}
                onClear={() => {}}
            />
        ),
    },
}

/** A ~300px pane — the narrowest a chart must still render in (columns floor at 20). */
export const Narrow300px: Story = {
    args: {
        empty: false,
        emptyMessage: 'No data to chart.',
        readout: <ChartReadout parts={['sum of priority by week of due', 'peak 3 (Jul 1)']} />,
        children: <div>chart content goes here</div>,
    },
    decorators: [narrowDecorator],
}
