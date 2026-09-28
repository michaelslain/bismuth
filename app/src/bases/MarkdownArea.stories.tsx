// Visual spec for <MarkdownArea> — the growing plain-text editor for a markdown property in a chip
// or cell. The harness holds the draft and what was committed, so every play asserts a real state.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import MarkdownArea from './MarkdownArea'

const meta = {
    title: 'Bases/MarkdownArea',
    component: MarkdownArea,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MarkdownArea>

export default meta
type Story = StoryObj<typeof meta>

const Harness = (p: { initial: string; autofocus?: boolean }) => {
    const [draft, setDraft] = createSignal(p.initial)
    const [committed, setCommitted] = createSignal('')
    const [reverted, setReverted] = createSignal(0)
    return (
        <div style={{ width: '280px' }}>
            <MarkdownArea
                value={draft()}
                autofocus={p.autofocus}
                onInput={setDraft}
                onBlur={() => setCommitted(draft())}
                onRevert={() => {
                    setDraft(p.initial)
                    setReverted(n => n + 1)
                }}
            />
            <span hidden data-testid="committed">
                {committed()}
            </span>
            <span hidden data-testid="reverted">
                {reverted()}
            </span>
        </div>
    )
}

export const Filled: Story = {
    render: () => <Harness initial={'First line.\nSecond line with **bold**.'} />,
}

/** Enter inserts a newline (it does not commit); blur commits the whole draft. */
export const EnterAddsALineBlurCommits: Story = {
    render: () => <Harness initial="one" autofocus />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const area = canvas.getByDisplayValue('one') as HTMLTextAreaElement
        await waitFor(() => expect(document.activeElement).toBe(area))
        await userEvent.type(area, '{Enter}two')
        await expect(canvas.getByTestId('committed')).toHaveTextContent('')
        area.blur()
        await waitFor(() => expect(canvas.getByTestId('committed').textContent).toBe('one\ntwo'))
    },
}

/** Escape reverts the draft to the original and leaves the field. */
export const EscapeReverts: Story = {
    render: () => <Harness initial="keep me" autofocus />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const area = canvas.getByDisplayValue('keep me') as HTMLTextAreaElement
        await waitFor(() => expect(document.activeElement).toBe(area))
        await userEvent.type(area, ' edited')
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(canvas.getByTestId('reverted')).toHaveTextContent('1'))
        await expect(area.value).toBe('keep me')
        await expect(canvas.getByTestId('committed').textContent).toBe('keep me')
    },
}
