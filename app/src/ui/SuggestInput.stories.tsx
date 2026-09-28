// Visual spec for <SuggestInput> — a text field with a suggestion popup (replaces <datalist>).
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import SuggestInput, { type SuggestOption } from './SuggestInput'
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

function Host(props: { initial?: string; options?: SuggestOption[] }) {
    const [value, setValue] = createSignal(props.initial ?? '')
    return (
        <div style={{ width: '240px', display: 'flex', 'flex-direction': 'column', gap: 'var(--sp-4)' }}>
            <SuggestInput
                value={value()}
                options={props.options ?? OPTIONS}
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
        // The popup is at least as wide as the field it hangs from.
        expect(list.getBoundingClientRect().width).toBeGreaterThanOrEqual(
            input(canvasElement).getBoundingClientRect().width,
        )
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
        await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
        expect(el.value).toBe('car')
        await userEvent.clear(el)
        await userEvent.type(el, 'd')
        await waitFor(() => expect(document.body.querySelector('.bismuth-popover')).not.toBeNull())
        await userEvent.keyboard('{Escape}')
        expect(document.body.querySelector('.bismuth-popover')).toBeNull()
        expect(el.value).toBe('d')
    },
}


const WORKOUT = [{ value: 'Workout' }, { value: 'Worklog' }, { value: 'Reading' }]

/** Enter on an untouched highlight keeps the typed text — it does not silently become "Workout". */
export const EnterKeepsTypedPrefix: Story = {
    render: () => <Host options={WORKOUT} />,
    play: async ({ canvasElement }) => {
        const el = input(canvasElement)
        await userEvent.type(el, 'Work')
        await waitFor(() => expect(document.body.querySelector('.bismuth-popover')).not.toBeNull())
        await userEvent.keyboard('{Enter}')
        expect(el.value).toBe('Work')
        expect(within(canvasElement).getByTestId('suggest-value').textContent).toBe('Work')
    },
}

/** ArrowDown touches the highlight (without moving it), so Enter accepts the option under it. */
export const ArrowThenEnterAccepts: Story = {
    render: () => <Host options={WORKOUT} />,
    play: async ({ canvasElement }) => {
        const el = input(canvasElement)
        await userEvent.type(el, 'Work')
        await waitFor(() => expect(document.body.querySelector('.bismuth-popover')).not.toBeNull())
        await userEvent.keyboard('{ArrowDown}{Enter}')
        expect(el.value).toBe('Workout')
        expect(within(canvasElement).getByTestId('suggest-value').textContent).toBe('Workout')
    },
}
