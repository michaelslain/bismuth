// Visual spec for <TranscriptSection>: one page's text, editable like a note.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import TranscriptSection from './TranscriptSection'

const meta: Meta<typeof TranscriptSection> = { title: 'Bases/TranscriptSection', component: TranscriptSection }
export default meta
type Story = StoryObj<typeof TranscriptSection>

const Demo = () => {
    const [text, setText] = createSignal('# A heading\nThe page as it was read, ==marked== here and there.')
    const page = {
        key: 'p1',
        label: 'page 1',
        get text() {
            return text()
        },
    }
    return (
        <div style={{ width: '520px', padding: '16px' }}>
            <TranscriptSection page={page} onSave={(_k, t) => setText(t)} />
        </div>
    )
}

/** Click the text and type, like a note; what you typed is saved a beat later. */
export const Editable: Story = {
    render: () => <Demo />,
    play: async ({ canvasElement }) => {
        const field = () => canvasElement.querySelector<HTMLElement>('.cm-content')!
        await waitFor(() => expect(field().getAttribute('contenteditable')).toBe('true'))
    },
}
