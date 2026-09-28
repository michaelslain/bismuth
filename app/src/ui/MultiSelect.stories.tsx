// Visual spec for <MultiSelect> — the dropdown of toggleable choices behind `tags`/
// `multiselect` base properties. Reads as Select's sibling (same trigger chrome, same
// AnchoredPopover + PopoverList + createMenuNav popover family) but every row TOGGLES and
// the list stays open across several picks. Controlled (value + onChange), so every story
// wires a real signal — clicking a row here visibly mutates the trigger's summary text.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import MultiSelect, { type MultiSelectProps } from './MultiSelect'

const meta = {
    title: 'UI/MultiSelect',
    component: MultiSelect,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof MultiSelect>

export default meta
type Story = StoryObj<typeof meta>

const TAG_OPTIONS = ['bug', 'frontend', 'urgent', 'docs', 'design']

function Controlled(props: Omit<MultiSelectProps, 'value' | 'onChange'> & {
    initial?: string[]
}) {
    const [value, setValue] = createSignal(props.initial ?? [])
    return (
        <div style={{ width: '260px' }}>
            <MultiSelect {...props} value={value()} onChange={setValue} />
            <div style={{ 'margin-top': '10px', 'font-size': 'var(--fs-ui)', color: 'var(--text-muted)' }}>
                selected: {JSON.stringify(value())}
            </div>
        </div>
    )
}

/** Nothing selected — the trigger shows the muted placeholder. */
export const Empty: Story = {
    render: () => <Controlled options={TAG_OPTIONS} placeholder="Pick tags…" />,
}

/** Some values already selected — the trigger shows them joined by ", ". */
export const WithValue: Story = {
    render: () => <Controlled options={TAG_OPTIONS} initial={['bug', 'urgent']} />,
}

/** Starts open — the exact shape a table cell opening straight into the editor needs. */
export const StartsOpen: Story = {
    render: () => (
        <Controlled options={TAG_OPTIONS} initial={['frontend']} open />
    ),
}

/** Interactive: open the trigger, click two rows — each toggle fires onChange immediately and
 *  the list stays open (both clicks land without re-querying for a freshly-opened popover). */
export const ToggleKeepsListOpen: Story = {
    render: () => <Controlled options={TAG_OPTIONS} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = canvas.getByRole('button')
        await userEvent.click(trigger)
        const popover = await waitFor(() => {
            const el = document.querySelector('.bismuth-popover') as HTMLElement | null
            if (!el) throw new Error('popover did not open')
            return el
        })
        const body = within(popover)
        await userEvent.click(await body.findByText('bug'))
        await expect(canvas.getByText(/selected:/)).toHaveTextContent('["bug"]')
        await userEvent.click(await body.findByText('urgent'))
        await expect(canvas.getByText(/selected:/)).toHaveTextContent('["bug","urgent"]')
        // Still open — a second row is clickable without reopening.
        await expect(document.querySelector('.bismuth-popover')).not.toBeNull()
    },
}

/** Interactive: typing filters the list to matching rows. */
export const FilterNarrowsRows: Story = {
    render: () => <Controlled options={TAG_OPTIONS} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button'))
        const popover = await waitFor(() => {
            const el = document.querySelector('.bismuth-popover') as HTMLElement | null
            if (!el) throw new Error('popover did not open')
            return el
        })
        const filterInput = document.querySelector(
            'input[placeholder="filter"]',
        ) as HTMLInputElement
        await userEvent.type(filterInput, 'bug')
        const body = within(popover)
        await expect(await body.findByText('bug')).toBeVisible()
        await expect(body.queryByText('urgent')).toBeNull()
    },
}

/** Interactive (`creatable`, the `tags` shape): typing a value nothing matches and pressing
 *  Enter adds it as a new selected value. */
export const CreatableAddsUnmatchedFilter: Story = {
    render: () => <Controlled options={TAG_OPTIONS} creatable />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button'))
        await waitFor(() => {
            const el = document.querySelector('.bismuth-popover') as HTMLElement | null
            if (!el) throw new Error('popover did not open')
            return el
        })
        const filterInput = document.querySelector(
            'input[placeholder="filter or add"]',
        ) as HTMLInputElement
        await userEvent.type(filterInput, 'brand-new{Enter}')
        await expect(canvas.getByText(/selected:/)).toHaveTextContent('["brand-new"]')
    },
}

/** Interactive: Escape closes the list and fires `onClose`. */
export const EscapeCloses: Story = {
    render: () => {
        const [closed, setClosed] = createSignal(false)
        return (
            <div style={{ width: '260px' }}>
                <MultiSelect
                    value={[]}
                    options={TAG_OPTIONS}
                    onChange={() => {}}
                    onClose={() => setClosed(true)}
                />
                <div style={{ 'margin-top': '10px', 'font-size': 'var(--fs-ui)', color: 'var(--text-muted)' }}>
                    onClose fired: {String(closed())}
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button'))
        await waitFor(() => {
            const el = document.querySelector('.bismuth-popover') as HTMLElement | null
            if (!el) throw new Error('popover did not open')
            return el
        })
        await userEvent.keyboard('{Escape}')
        await expect(canvas.getByText(/onClose fired:/)).toHaveTextContent('true')
        await expect(document.querySelector('.bismuth-popover')).toBeNull()
    },
}
