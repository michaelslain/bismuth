// Visual spec for <CardCell> — one Front/Back cell of the deck editor. The row variant renders
// markdown and commits on blur; the draft variant is a plain controlled field that reports Enter.
// Both interactive stories hold real state and assert it in play().
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import CardCell from './CardCell'

const meta = {
    title: 'Bases/CardCell',
    component: CardCell,
    parameters: { layout: 'padded' },
    decorators: [
        Story => (
            <div style={{ width: '320px' }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof CardCell>

export default meta
type Story = StoryObj<typeof meta>

const area = (root: HTMLElement) => root.querySelector('textarea') as HTMLTextAreaElement

/** Front: the rendered markdown overlay drives the height. */
export const Front: Story = {
    args: { field: 'front', value: '**Capital** of France?', placeholder: 'front…' },
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('[data-cell="front"]')).not.toBeNull()
        expect(canvasElement.querySelector('strong')?.textContent).toBe('Capital')
    },
}

/** Back: told apart by `data-cell`, which is also what tones its text. */
export const Back: Story = {
    args: { field: 'back', value: 'Paris', placeholder: 'back…' },
    play: async ({ canvasElement }) =>
        expect(canvasElement.querySelector('[data-cell="back"]')).not.toBeNull(),
}

/** Empty: the placeholder shows in the overlay. */
export const Empty: Story = {
    args: { field: 'front', value: '', placeholder: 'front…' },
    play: async ({ canvasElement }) =>
        expect(canvasElement.textContent).toContain('front…'),
}

/** Edit and blur: commits once, with the edited text — and not at all when nothing changed. */
export const CommitsOnBlur: Story = {
    args: { field: 'front', value: 'Capital of Italy', placeholder: 'front…' },
    render: args => {
        const [commits, setCommits] = createSignal<string[]>([])
        return (
            <>
                <CardCell {...args} onCommit={v => setCommits(c => [...c, v])} />
                <span data-testid="commits">{commits().join('|')}</span>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const ta = area(canvasElement)
        const out = () => canvasElement.querySelector('[data-testid="commits"]')!.textContent
        await userEvent.click(ta)
        await userEvent.tab() // blur untouched
        expect(out()).toBe('')
        await userEvent.click(ta)
        await userEvent.type(ta, '?')
        await userEvent.tab()
        expect(out()).toBe('Capital of Italy?')
    },
}

/** Draft: a controlled plain field; Enter reports (Shift+Enter does not). */
export const Draft: Story = {
    args: { field: 'front', value: '', placeholder: 'front of new card…', draft: true },
    render: args => {
        const [value, setValue] = createSignal('')
        const [enters, setEnters] = createSignal(0)
        return (
            <>
                <CardCell
                    {...args}
                    value={value()}
                    onInput={setValue}
                    onEnter={() => setEnters(n => n + 1)}
                />
                <span data-testid="enters">{enters()}</span>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const ta = area(canvasElement)
        await userEvent.click(ta)
        await userEvent.type(ta, 'hola')
        expect(ta.value).toBe('hola')
        await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
        expect(canvasElement.querySelector('[data-testid="enters"]')!.textContent).toBe('0')
        await userEvent.keyboard('{Enter}')
        expect(canvasElement.querySelector('[data-testid="enters"]')!.textContent).toBe('1')
    },
}
