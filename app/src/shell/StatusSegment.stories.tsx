// Visual spec for <StatusSegment> — one non-builtin readout in the status bar (shell/StatusBar).
// Each story renders the segment inside a REAL <StatusBar> (location on the left, the story's
// segment after it) so what shows is exactly what the bar shows — the bar's own row styling, not
// a decorator copy of it that could drift. `Empty` sits an empty segment between two text segments
// to prove it leaves no gap.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { StatusBar } from './StatusBar'
import type { StatusSegment as StatusSegmentData } from '../../../core/src/statusBarEval'

const noop = () => {}

const meta = {
    title: 'Shell/StatusSegment',
    component: StatusBar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof StatusBar>

export default meta
type Story = StoryObj<typeof meta>

const barProps = {
    location: '/Users/michaelslain/Documents/notes/projects/roadmap.md',
    connected: true,
    daemon: 'idle' as const,
    inboxCount: 0,
    onCopyLocation: noop,
    onOpenInbox: noop,
    onRunCommand: noop,
    onTrust: noop,
}

const locationSegment: StatusSegmentData = {
    id: 'location',
    builtin: 'location',
    align: 'left',
    text: '',
}

const base: StatusSegmentData = { id: 'files', align: 'right', text: 'files: 412' }

const inBar = (...segments: StatusSegmentData[]) => (
    <StatusBar {...barProps} segments={[locationSegment, ...segments]} />
)

export const Plain: Story = {
    render: () => inBar(base),
}

export const Toned: Story = {
    render: () => inBar({ ...base, tone: 'gold' }),
}

export const Clickable: Story = {
    render: () => inBar({ ...base, command: 'open-inbox', tooltip: 'open the inbox' }),
}

export const Untrusted: Story = {
    render: () =>
        inBar({
            id: 'branch',
            align: 'left',
            text: '',
            untrusted: { command: 'git branch --show-current' },
        }),
}

export const Errored: Story = {
    render: () => inBar({ ...base, text: '', error: 'query failed: unknown source' }),
}

export const WithIcon: Story = {
    render: () => inBar({ ...base, icon: 'Calendar' }),
}

export const Empty: Story = {
    render: () =>
        inBar(
            { id: 'a', align: 'right', text: 'files: 412' },
            { ...base, id: 'empty', text: '' },
            { id: 'b', align: 'right', text: '3 due', tone: 'gold' },
        ),
}
