// Visual spec for <GcalStatusRow> — the connected status row: green dot, account, disconnect.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import GcalStatusRow from './GcalStatusRow'

const meta = {
    title: 'Calendar/GcalStatusRow',
    component: GcalStatusRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof GcalStatusRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: { account: 'alex@example.com', onDisconnect: () => {} },
    play: ({ canvasElement }) => {
        // The row is exactly one chrome band tall (--h-band, 36px), not the ~50px it measured
        // when 12px block padding stacked on the 24px button.
        const row = canvasElement.querySelector<HTMLElement>('div')!
        const probe = document.createElement('div')
        probe.style.height = 'var(--h-band)'
        canvasElement.appendChild(probe)
        const band = probe.getBoundingClientRect().height
        probe.remove()
        expect(band).toBeGreaterThan(0)
        expect(row.getBoundingClientRect().height).toBeCloseTo(band, 0)
    },
}

/** A long account address truncates with an ellipsis instead of pushing disconnect out. */
export const LongAccount: Story = {
    args: {
        account:
            'a.very.long.address.that.keeps.going@some-subdomain.example-company.com',
        onDisconnect: () => {},
    },
    play: ({ canvasElement }) => {
        // The cut-off address is still reachable in full: the span carries it as its title.
        const acct = within(canvasElement).getByTitle(
            'a.very.long.address.that.keeps.going@some-subdomain.example-company.com',
        )
        expect(acct.scrollWidth).toBeGreaterThan(acct.clientWidth)
    },
    decorators: [
        Story => (
            <div style={{ width: '20rem' }}>
                <Story />
            </div>
        ),
    ],
}

export const Busy: Story = {
    args: { ...Default.args, disabled: true },
}

/** Clicking disconnect calls onDisconnect once. */
export const Interactive: Story = {
    args: Default.args,
    render: args => {
        const [n, setN] = createSignal(0)
        return (
            <>
                <GcalStatusRow
                    account={args.account}
                    onDisconnect={() => setN(v => v + 1)}
                />
                <output data-disconnect-count>{n()}</output>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /disconnect/i }))
        await expect(
            canvasElement.querySelector('[data-disconnect-count]')?.textContent,
        ).toBe('1')
    },
}
