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

/** UNSET. The empty value matches the `(clear)` row, which used to put "(clear)" in the trigger in
 *  full `--fg` — an unset field reading like a chosen value. It reads the muted placeholder now. */
export const Unset: Story = {
    render: () => <Harness initial={null} />,
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector<HTMLElement>('[data-select-trigger]')!
        expect(trigger.textContent).not.toContain('(clear)')
        expect(trigger.textContent).toContain('Select')
        const text = trigger.firstElementChild as HTMLElement
        const probe = document.createElement('span')
        probe.style.color = 'var(--text-muted)'
        canvasElement.appendChild(probe)
        expect(getComputedStyle(text).color).toBe(getComputedStyle(probe).color)
        probe.remove()
    },
}

/** A known status keeps its dot and its category colour while edited, as it has at rest. */
export const StatusKeepsItsDot: Story = {
    render: () => {
        const [v, setV] = createSignal<unknown>('doing')
        return (
            <div style={{ width: '220px' }}>
                <SelectValue
                    options={['todo', 'doing', 'done']}
                    value={v()}
                    onCommit={setV}
                    onCancel={() => {}}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector<HTMLElement>('[data-select-trigger]')!
        const dot = trigger.parentElement!.firstElementChild as HTMLElement
        expect(dot.tagName).toBe('SPAN')
        expect(getComputedStyle(dot).width).toBe('6px')
        expect(getComputedStyle(dot).backgroundColor).toBe(getComputedStyle(trigger).color)
    },
}
