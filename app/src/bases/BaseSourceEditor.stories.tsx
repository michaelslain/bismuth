// Visual spec for <BaseSourceEditor> — the raw-file editor behind a base's Source toggle: a
// line-number gutter beside a textarea, Save writes the file, Cancel closes without writing.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import BaseSourceEditor from './BaseSourceEditor'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'

const PATH = 'boards/books.md'
const BODY = '---\ntype: base\nviews:\n  - type: table\n---\n\n- title: Dune\n'

const meta = {
    title: 'Bases/BaseSourceEditor',
    component: BaseSourceEditor,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BaseSourceEditor>

export default meta
type Story = StoryObj<typeof meta>

/** Holds "is the editor still open" in a signal, the way BaseView's Source toggle does. */
function Harness() {
    setTransport(fakeTransport({ files: { [PATH]: BODY } }))
    const [open, setOpen] = createSignal(true)
    return (
        <div style={{ height: '320px', display: 'flex', 'flex-direction': 'column' }}>
            <Show when={open()} fallback={<div data-closed="">closed</div>}>
                <BaseSourceEditor path={PATH} onClose={() => setOpen(false)} />
            </Show>
        </div>
    )
}

const args = { path: PATH, onClose: () => {} }

/** The file loads into the textarea with one gutter number per line. */
export const Loaded: Story = {
    args,
    render: () => <Harness />,
    play: async ({ canvasElement }) => {
        const area = await waitFor(() => {
            const t = canvasElement.querySelector('textarea')
            expect(t).toBeTruthy()
            return t!
        })
        expect(area.value).toBe(BODY)
    },
}

/** Typing then Save writes the file and closes. */
export const SaveWrites: Story = {
    args,
    render: () => <Harness />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const area = await waitFor(() => {
            const t = canvasElement.querySelector('textarea')
            expect(t).toBeTruthy()
            return t!
        })
        await userEvent.type(area, '- title: Emma')
        await userEvent.click(canvas.getByText('save'))
        await waitFor(() =>
            expect(canvasElement.querySelector('[data-closed]')).toBeTruthy(),
        )
        expect(await api.read(PATH)).toContain('- title: Emma')
    },
}

/** Cancel closes and leaves the file as it was. */
export const CancelDiscards: Story = {
    args,
    render: () => <Harness />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const area = await waitFor(() => {
            const t = canvasElement.querySelector('textarea')
            expect(t).toBeTruthy()
            return t!
        })
        await userEvent.type(area, 'scribble')
        await userEvent.click(canvas.getByText('cancel'))
        await waitFor(() =>
            expect(canvasElement.querySelector('[data-closed]')).toBeTruthy(),
        )
        expect(await api.read(PATH)).toBe(BODY)
    },
}
