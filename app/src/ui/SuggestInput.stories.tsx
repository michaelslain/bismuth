// Visual spec for <SuggestInput> — a text field with a suggestion popup (replaces <datalist>).
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import SuggestInput from './SuggestInput'
import Text from './Text'

const OPTIONS = [
    { value: 'cat', label: 'cat', detail: 'animal' },
    { value: 'car', label: 'car', detail: 'vehicle' },
    { value: 'dog', label: 'dog', detail: 'animal' },
    { value: 'boat', label: 'boat', detail: 'vehicle' },
]

const meta = {
    title: 'UI/SuggestInput',
    component: SuggestInput,
    parameters: { layout: 'centered' },
    args: { value: '', options: OPTIONS, onInput: () => {} },
} satisfies Meta<typeof SuggestInput>

export default meta
type Story = StoryObj<typeof meta>

function Host(props: { initial?: string }) {
    const [value, setValue] = createSignal(props.initial ?? '')
    return (
        <div style={{ width: '240px', display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
            <SuggestInput
                value={value()}
                options={OPTIONS}
                placeholder="type a word"
                onInput={setValue}
            />
            <Text as="span" size="micro" tone="muted" data-testid="suggest-value">
                {value()}
            </Text>
        </div>
    )
}

const input = (el: HTMLElement) => within(el).getByRole('combobox') as HTMLInputElement

export const Empty: Story = { render: () => <Host /> }

/** Typing "ca" filters to the two prefix matches, with the first highlighted. */
export const TypingFilters: Story = {
    render: () => <Host />,
    play: async ({ canvasElement }) => {
        await userEvent.type(input(canvasElement), 'ca')
        await waitFor(() => expect(document.body.querySelector('.bismuth-popover')).not.toBeNull())
        const list = document.body.querySelector('.bismuth-popover') as HTMLElement
        const rows = [...list.children] as HTMLElement[]
        expect(rows.map(r => r.textContent)).toEqual(['catanimal', 'carvehicle'])
        expect(rows[0]!.className).toContain('bismuth-popover-row--selected')
        expect(rows[1]!.className).not.toContain('bismuth-popover-row--selected')
    },
}

/** A value that matches no option is kept as typed. */
export const CreatableValue: Story = {
    render: () => <Host />,
    play: async ({ canvasElement }) => {
        await userEvent.type(input(canvasElement), 'zebra')
        expect(input(canvasElement).value).toBe('zebra')
        expect(document.body.querySelector('.bismuth-popover')).toBeNull()
        expect(within(canvasElement).getByTestId('suggest-value').textContent).toBe('zebra')
    },
}

/** Confirm accepts the highlighted suggestion; a first dismiss closes the popup. */
export const AcceptAndDismiss: Story = {
    render: () => <Host />,
    play: async ({ canvasElement }) => {
        const el = input(canvasElement)
        await userEvent.type(el, 'c')
        await waitFor(() => expect(document.body.querySelector('.bismuth-popover')).not.toBeNull())
        await userEvent.keyboard('{ArrowDown}{Enter}')
        expect(el.value).toBe('car')
        await userEvent.clear(el)
        await userEvent.type(el, 'd')
        await waitFor(() => expect(document.body.querySelector('.bismuth-popover')).not.toBeNull())
        await userEvent.keyboard('{Escape}')
        expect(document.body.querySelector('.bismuth-popover')).toBeNull()
        expect(el.value).toBe('d')
    },
}

