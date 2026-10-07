// Visual spec for <ChartFrame> — the outer padding/scroll/empty-state chrome shared by
// Bar/Heatmap/Line/Stat views, extracted out of the old bases/Charts.module.css (imported
// directly by all four). See ChartFrame.tsx for why.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChartFrame from './ChartFrame'
import Readout from '../ui/Readout'
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
        children: <div>chart content goes here</div>,
    },
}

/** Empty: the one `no data to chart` state renders instead of `children`. */
export const Empty: Story = {
    args: {
        empty: true,
        children: <div>chart content goes here</div>,
    },
}

/** Empty with a hint: the same title, plus the view's own remedy underneath (the heatmap's). */
export const EmptyWithHint: Story = {
    args: {
        empty: true,
        emptyHint: 'set an x date column in view settings',
        children: <div>chart content goes here</div>,
    },
}

/** All four slots at once: readout above the body, footer + drill below. */
export const WithReadoutFooterDrill: Story = {
    args: {
        empty: false,
        readout: <Readout parts={['Jul 20', '3', '2 notes']} tone="default" />,
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
        readout: <Readout parts={['sum of priority by week of due', 'peak 3 (Jul 1)']} tone="muted" />,
        children: <div>chart content goes here</div>,
    },
    decorators: [narrowDecorator],
}
