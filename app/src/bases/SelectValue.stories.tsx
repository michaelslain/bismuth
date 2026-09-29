// Visual spec for <SelectValue> — a declared `select` as a dropdown with a `(clear)` entry. The
// harness holds the committed value, so each play asserts the write it caused.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import SelectValue from './SelectValue'

const meta = {
    title: 'Bases/SelectValue',
    component: SelectValue,
} satisfies Meta<typeof SelectValue>

export default meta
type Story = StoryObj<typeof meta>

const OPTIONS = ['Todo', 'Doing', 'Done']

const Harness = (p: { initial: unknown }) => {
    const [value, setValue] = createSignal<unknown>(p.initial)
    const [committed, setCommitted] = createSignal('none')
    return (
        <div style={{ width: '220px' }}>
            <SelectValue
                options={OPTIONS}
                value={value()}
                onCommit={v => {
                    setValue(v)
                    setCommitted(JSON.stringify(v))
                }}
                onCancel={() => setCommitted('cancelled')}
            />
            <span hidden data-testid="committed">
                {committed()}
            </span>
        </div>
    )
}

const openMenu = async (canvasElement: HTMLElement) => {
    const trigger = canvasElement.querySelector<HTMLElement>('[data-select-trigger]')!
    await userEvent.click(trigger)
    return within(canvasElement.ownerDocument.body)
}
// PopoverList rows activate on click (unlike DatePicker's mousedown rows).
const choose = async (el: HTMLElement) => userEvent.click(el)

export const Current: Story = {
    render: () => <Harness initial="Doing" />,
}

/** A stored value outside the declared options is still the current selection. */
export const LegacyValue: Story = {
    render: () => <Harness initial="Blocked" />,
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('Blocked')).toBeInTheDocument()
    },
}

export const PickCommits: Story = {
    render: () => <Harness initial="Doing" />,
    play: async ({ canvasElement }) => {
        const body = await openMenu(canvasElement)
        await choose(await body.findByText('Done'))
        await waitFor(() =>
            expect(within(canvasElement).getByTestId('committed')).toHaveTextContent('"Done"'),
        )
    },
}

export const ClearCommitsNull: Story = {
    render: () => <Harness initial="Doing" />,
    play: async ({ canvasElement }) => {
        const body = await openMenu(canvasElement)
        await choose(await body.findByText('(clear)'))
        await waitFor(() =>
            expect(within(canvasElement).getByTestId('committed')).toHaveTextContent('null'),
        )
    },
}
