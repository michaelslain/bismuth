// app/src/daemon/DaemonSection.stories.tsx
// Visual spec for <DaemonSection> — the shared frame every right-column section (inbox, crons,
// services, log) composes: heading + count, the empty one-liner, and the section's own rows.
// Every section sizes to its content now — DaemonOverview owns the column's one scroll and row-
// limits what each section renders. Rows are plain `Text` stand-ins here — the real row
// components (InboxRow, DaemonRow, log rows) are proven in their own story files.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { type JSX } from 'solid-js'
import DaemonSection from './DaemonSection'
import Text from '../ui/Text'

const meta = {
    title: 'Daemon/DaemonSection',
    component: DaemonSection,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonSection>

export default meta
type Story = StoryObj<typeof meta>

function Frame(props: { height: string; children: JSX.Element }) {
    return (
        <div
            style={{
                width: '420px',
                height: props.height,
                'max-width': '100%',
                display: 'flex',
                'flex-direction': 'column',
            }}
        >
            {props.children}
        </div>
    )
}

function Row(props: { children: JSX.Element }) {
    return (
        <Text as="div" size="ui">
            {props.children}
        </Text>
    )
}

export const WithCount: Story = {
    render: () => (
        <Frame height="200px">
            <DaemonSection title="crons" count={3} empty="no crons yet // ask the daemon" isEmpty={false}>
                <Row>consolidate memory // every hour // ok</Row>
                <Row>review vault // every 4 hours // ok</Row>
                <Row>backup vault // nightly // off</Row>
            </DaemonSection>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('crons')).toBeInTheDocument()
        await expect(canvas.getByText('3')).toBeInTheDocument()
        const section = canvasElement.querySelector('[data-testid="daemon-section-crons"]')!
        await expect(section).toBeInTheDocument()
    },
}

export const WithoutCount: Story = {
    render: () => (
        <Frame height="200px">
            <DaemonSection title="log" empty="nothing logged yet" isEmpty={false}>
                <Row>10:02 daemon consolidated memory 1s</Row>
                <Row>10:04 daemon reviewed vault 4s</Row>
            </DaemonSection>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('log')).toBeInTheDocument()
        await expect(canvas.queryByText('0')).toBeNull()
    },
}

export const Empty: Story = {
    render: () => (
        <Frame height="120px">
            <DaemonSection title="crons" count={0} empty="no crons yet // ask the daemon" isEmpty />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('no crons yet // ask the daemon')).toBeInTheDocument()
    },
}

export const EmptyWithTrailingChild: Story = {
    render: () => (
        <Frame height="150px">
            <DaemonSection title="inbox" count={0} empty="nothing needs you" isEmpty>
                <Row>2 resolved // show</Row>
            </DaemonSection>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
        await expect(canvas.getByText('2 resolved // show')).toBeInTheDocument()
    },
}
