// Visual spec for <PageStatus>: the status cell at a page divider's right end.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { Component } from 'solid-js'
import { expect, fn, userEvent, within } from 'storybook/test'
import PageStatus, { type PageStatusProps } from './PageStatus'
import { Label, Row } from '../ui/_storyKit'

const meta = {
    title: 'Bases/PageStatus',
    component: PageStatus,
} satisfies Meta<typeof PageStatus>

export default meta
type Story = StoryObj<typeof meta>

const LONG = 'the ai reader returned an empty answer for this page, it may be blank or the request timed out upstream, try again'

/** A divider-width strip so each cell sits where it does in the reader: right end of a rule. */
const Strip: Component<{ label: string } & PageStatusProps> = props => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', width: '560px' }}>
        <Label>{props.label}</Label>
        <div
            data-strip
            style={{
                display: 'flex',
                'justify-content': 'space-between',
                'align-items': 'baseline',
                gap: '12px',
                'border-bottom': '1px solid var(--border)',
                padding: '4px 0',
            }}
        >
            <span style={{ color: 'var(--text-muted)', 'font-size': 'var(--fs-ui)', flex: 'none', 'white-space': 'nowrap' }}>page 3</span>
            <PageStatus state={props.state} empty={props.empty} onRetry={props.onRetry} />
        </div>
    </div>
)

/** Every line of the cell, one strip each. */
export const AllStates: Story = {
    name: 'All states',
    render: () => (
        <Row column gap="16px">
            <Strip label="done, on-device" state={{ page: 3, status: 'done', engine: 'on-device' }} />
            <Strip label="done, math reader" state={{ page: 3, status: 'done', engine: 'marker' }} />
            <Strip label="done, ai" state={{ page: 3, status: 'done', engine: 'ai' }} />
            <Strip label="queued" state={{ page: 3, status: 'queued' }} />
            <Strip label="reading" state={{ page: 3, status: 'reading', engine: 'marker' }} />
            <Strip label="failed" state={{ page: 3, status: 'failed', error: 'the page image could not be read' }} onRetry={() => {}} />
            <Strip label="failed, 120-char reason" state={{ page: 3, status: 'failed', error: LONG }} onRetry={() => {}} />
            <Strip label="no text, no job" empty onRetry={() => {}} />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('math reader')).toBeInTheDocument()
        await expect(c.getAllByText('queued').length).toBe(2)
        await expect(c.getByText('reading // math reader')).toBeInTheDocument()
        await expect(c.getByText('not transcribed')).toBeInTheDocument()
        await expect(c.getByRole('button', { name: /transcribe/ })).toBeInTheDocument()
        await expect(c.queryByText(/marker/)).toBeNull()
    },
}

/** A 120-character reason is cut at 60 with an ellipsis and `[ retry ]` stays visible. */
export const LongFailure: Story = {
    name: 'Long failure',
    args: { state: { page: 3, status: 'failed', error: LONG }, onRetry: fn() },
    render: args => <Strip label="failed, 120-char reason" {...args} />,
    play: async ({ canvasElement, args }) => {
        const c = within(canvasElement)
        const reason = canvasElement.querySelector('[data-page-status-reason]')!
        await expect(reason.textContent!.length).toBeLessThanOrEqual('failed // '.length + 60)
        await expect(reason.textContent!.endsWith('…')).toBe(true)
        const retry = c.getByRole('button', { name: /retry/ })
        const strip = canvasElement.querySelector('[data-strip]')!.getBoundingClientRect()
        const r = retry.getBoundingClientRect()
        await expect(r.right).toBeLessThanOrEqual(strip.right + 0.5)
        await expect(r.width).toBeGreaterThan(0)
        await userEvent.click(retry)
        await expect(args.onRetry).toHaveBeenCalledTimes(1)
    },
}
