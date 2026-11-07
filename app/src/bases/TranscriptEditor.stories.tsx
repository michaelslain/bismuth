// Visual spec for <TranscriptEditor> — one page's transcript open for fixing by hand.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TranscriptEditor from './TranscriptEditor'

const meta = {
    title: 'Bases/TranscriptEditor',
    component: TranscriptEditor,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TranscriptEditor>

export default meta
type Story = StoryObj<typeof meta>

const TEXT = String.raw`## Polynomials Applied to Operators

plug in the operator into the po1ynomials

minimal polynomial is unique, degree $\leq \dim V$`

function Live() {
    const [saved, setSaved] = createSignal('')
    return (
        <div style={{ width: '1000px', height: '560px', display: 'flex', 'flex-direction': 'column' }} data-saved={saved()}>
            <TranscriptEditor title="page 4" text={TEXT} onSave={setSaved} onCancel={() => {}} />
        </div>
    )
}

/** The page's markdown in the prose face; save waits until something changed, and saves the new text. */
export const EditPage: Story = {
    name: 'Edit page',
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('edit text // page 4')).toBeInTheDocument()
        const save = c.getByRole('button', { name: 'save' })
        await expect(save).toBeDisabled()
        const cm = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('.cm-content')
            expect(el?.textContent).toContain('po1ynomials')
            return el!
        })
        cm.focus()
        // type at the end of the text, as a person fixing the last line would
        const sel = window.getSelection()!
        sel.selectAllChildren(cm)
        sel.collapseToEnd()
        await userEvent.keyboard(' fixed')
        await waitFor(() => expect(save).toBeEnabled())
        await userEvent.click(save)
        await waitFor(() => expect(canvasElement.querySelector<HTMLElement>('[data-saved]')!.dataset.saved).toContain('fixed'))
    },
}

/** A save in flight: both buttons wait. */
export const Saving: Story = {
    render: () => (
        <div style={{ width: '1000px', height: '560px', display: 'flex', 'flex-direction': 'column' }}>
            <TranscriptEditor title="page 4" text={TEXT} busy onSave={() => {}} onCancel={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByRole('button', { name: 'saving' })).toBeDisabled()
    },
}
