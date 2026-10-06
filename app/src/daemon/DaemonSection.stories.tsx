// app/src/daemon/DaemonSection.stories.tsx
// Visual spec for <DaemonSection> — the quiet box every right-column section (inbox, crons,
// services, log) composes: heading + count, the empty one-liner, and the section's own rows.
// Every section sizes to its content now — DaemonOverview owns the column's one scroll and row-
// limits what each section renders. Rows are plain `Text` stand-ins here — the real row
// components (InboxRow, DaemonRow, log rows) are proven in their own story files.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, fn, within } from 'storybook/test'
import { type JSX } from 'solid-js'
import DaemonSection from './DaemonSection'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'

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
                background: 'var(--bg)',
                padding: 'var(--sp-4)',
                'box-sizing': 'content-box',
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
            <DaemonSection
                title="crons"
                count={3}
                empty="no crons yet // ask the daemon"
                isEmpty={false}
            >
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
        const section = canvasElement.querySelector(
            '[data-testid="daemon-section-crons"]',
        )!
        await expect(section).toBeInTheDocument()
    },
}

export const WithoutCount: Story = {
    render: () => (
        <Frame height="200px">
            <DaemonSection
                title="log"
                empty="nothing logged yet"
                isEmpty={false}
            >
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
            <DaemonSection
                title="crons"
                count={0}
                empty="no crons yet // ask the daemon"
                isEmpty
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('no crons yet // ask the daemon'),
        ).toBeInTheDocument()
    },
}

export const EmptyWithTrailingChild: Story = {
    render: () => (
        <Frame height="150px">
            <DaemonSection
                title="inbox"
                count={0}
                empty="nothing needs you"
                isEmpty
            >
                <Row>2 resolved</Row>
            </DaemonSection>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
        await expect(canvas.getByText('2 resolved')).toBeInTheDocument()
    },
}

/** The whole box opens the section — a click on its bare space or its heading — but a click on
 *  an item inside it (here a button standing in for a row) is that item's alone. */
const openSection = fn()
const openRow = fn()
export const Openable: Story = {
    render: () => (
        <Frame height="200px">
            <DaemonSection
                title="crons"
                count={3}
                empty="no crons yet // ask the daemon"
                isEmpty={false}
                onOpen={openSection}
            >
                <PlainButton onClick={openRow}>
                    <Row>consolidate memory // every hour // ok</Row>
                </PlainButton>
                <Row>review vault // every 4 hours // ok</Row>
            </DaemonSection>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        openSection.mockClear()
        openRow.mockClear()
        const canvas = within(canvasElement)
        const box =
            canvasElement.querySelector<HTMLElement>('[data-section-box]')!
        await expect(box.dataset.openable).toBe('true')
        // Bare box space opens it.
        fireEvent.click(box)
        await expect(openSection).toHaveBeenCalledTimes(1)
        // A non-interactive line inside the box opens it too.
        fireEvent.click(canvas.getByText('review vault // every 4 hours // ok'))
        await expect(openSection).toHaveBeenCalledTimes(2)
        // An item inside the box does its own thing and does NOT open the section.
        fireEvent.click(
            canvas.getByText('consolidate memory // every hour // ok'),
        )
        await expect(openRow).toHaveBeenCalledTimes(1)
        await expect(openSection).toHaveBeenCalledTimes(2)
        // The heading is a real button (the keyboard path), and opens it once.
        fireEvent.click(canvas.getByRole('button', { name: 'open crons' }))
        await expect(openSection).toHaveBeenCalledTimes(3)
    },
}

export const Attention: Story = {
    render: () => (
        <Frame height="220px">
            <DaemonSection
                title="inbox"
                count={2}
                countLabel="2 need you"
                attention
                empty="nothing needs you"
                isEmpty={false}
                onOpen={() => {}}
            >
                <Row>reply to dana // from answer-emails // 2h ago</Row>
                <Row>approve invoice draft // from billing // 5h ago</Row>
            </DaemonSection>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const label = canvas.getByText('2 need you')
        await expect(label.closest('[data-section-heading]')).not.toBeNull()
        const box = canvasElement.querySelector('[data-section-box]')!
        await expect(box.getAttribute('data-attention')).toBe('true')
    },
}

export const AttentionEmpty: Story = {
    render: () => (
        <Frame height="120px">
            <DaemonSection
                title="inbox"
                count={0}
                empty="nothing needs you"
                isEmpty
                onOpen={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
        const box = canvasElement.querySelector('[data-section-box]')!
        await expect(box.getAttribute('data-attention')).toBe('false')
    },
}
