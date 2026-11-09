// Visual and behavioural spec for <TranscribeAll>: the bar's whole-document transcribe button, with
// real menu rows and the real question, over a fake job client whose pages advance on `tick`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TranscribeAll from './TranscribeAll'
import TranscribeProgress from './TranscribeProgress'
import { fakeTranscribe, type FakeTranscription } from './_transcriptionFake'

const meta = { title: 'Bases/TranscribeAll', component: TranscribeAll } satisfies Meta<typeof TranscribeAll>

export default meta
type Story = StoryObj<typeof meta>

const FILE = 'scans/notebook.pdf'
let fk: FakeTranscription

const setup = (filled: number[]) => () => {
    fk = fakeTranscribe({ pageCount: () => 3 })
    for (const p of filled) fk.texts.set(`${FILE}#${p}`, `text of page ${p}`)
    return fk.install()
}

const Bar = () => {
    const ctl = fk.controller()
    return (
        <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', padding: '40px' }}>
            <TranscribeProgress transcription={ctl} lead={false} />
            <TranscribeAll files={[FILE]} pages={3} transcription={ctl} />
        </div>
    )
}

const pick = async (root: HTMLElement, row: string) => {
    await userEvent.click(within(root).getByRole('button', { name: 'transcribe all' }))
    await userEvent.click(await within(document.body).findByText(row))
}

/** No text yet: a pick starts the run at once, and the button waits for it. */
export const NothingToReplace: Story = {
    beforeEach: setup([]),
    render: () => <Bar />,
    play: async ({ canvasElement }) => {
        await pick(canvasElement, 'transcribe all 3 pages with ai')
        await waitFor(() => expect(fk.calls).toEqual([{ file: FILE, engine: 'ai' }]))
        await waitFor(() => expect(within(canvasElement).getByRole('button', { name: 'transcribe all' })).toBeDisabled())
    },
}

/** Pages hold text: it asks, and `keep the text` starts nothing. */
export const AsksBeforeReplacing: Story = {
    beforeEach: setup([1, 2]),
    render: () => <Bar />,
    play: async ({ canvasElement }) => {
        await pick(canvasElement, 'transcribe all 3 pages with the math reader')
        const body = within(document.body)
        await body.findByText('replace the text of 2 pages?')
        await userEvent.click(body.getByRole('button', { name: 'keep the text' }))
        await waitFor(() => expect(body.queryByText('replace the text of 2 pages?')).toBeNull())
        await expect(fk.calls).toEqual([])
    },
}

/** `replace` runs the reader that was picked over every page. */
export const ReplaceRuns: Story = {
    beforeEach: setup([1, 2, 3]),
    render: () => <Bar />,
    play: async ({ canvasElement }) => {
        await pick(canvasElement, 'transcribe all 3 pages on-device')
        const body = within(document.body)
        await userEvent.click(await body.findByRole('button', { name: 'replace' }))
        await waitFor(() => expect(fk.calls).toEqual([{ file: FILE, engine: 'on-device' }]))
    },
}
