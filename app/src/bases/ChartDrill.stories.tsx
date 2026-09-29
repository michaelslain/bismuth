// Visual spec for <ChartDrill> — the note list opened under a chart when a bucket is clicked.
// "With opener" holds real state: clicking `[ clear ]` actually hides the drill, same as a bucket
// click would in a real chart view. A row with a write target renders as a `NoteLink`, which opens
// a note via the app-wide `bismuth-open` event (see NoteLink.tsx) rather than calling `onOpen`
// directly — the stories below listen for that event to prove the click really fires.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import { createSignal, onCleanup, Show } from 'solid-js'
import ChartDrill from './ChartDrill'
import { EMPTY_FILE, type Row } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/ChartDrill',
    component: ChartDrill,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChartDrill>

export default meta
type Story = StoryObj<typeof meta>

function fileRow(name: string): Row {
    return {
        file: { ...EMPTY_FILE, name, basename: name, path: `${name}.md` },
        note: {},
        formula: {},
    }
}

const THREE_ROWS = [fileRow('Morning pages'), fileRow('Standup notes'), fileRow('Retro')]
const THIRTY_ROWS = Array.from({ length: 30 }, (_, i) => fileRow(`Note ${i + 1}`))

/** Real state on both seams: clicking `[ clear ]` sets `open` false and the drill disappears;
 *  clicking a row's note link fires the app-wide `bismuth-open` event (see NoteLink.tsx), which
 *  this harness captures into `opened` and prints. `onOpen` itself is only a presence check
 *  (has a write target?) — the link, not the callback, opens the note. */
function WithOpenerHarness() {
    const [open, setOpen] = createSignal(true)
    const [opened, setOpened] = createSignal('nothing yet')
    const onOpenEvent = (e: Event) => setOpened((e as CustomEvent<string>).detail)
    window.addEventListener('bismuth-open', onOpenEvent)
    onCleanup(() => window.removeEventListener('bismuth-open', onOpenEvent))
    return (
        <div>
            <Show
                when={open()}
                fallback={<div>drill cleared — click a bucket again to reopen</div>}
            >
                <ChartDrill
                    title="Jul 20"
                    rows={THREE_ROWS}
                    onOpen={() => {}}
                    onClear={() => setOpen(false)}
                />
            </Show>
            <div data-testid="opened">opened: {opened()}</div>
        </div>
    )
}

export const WithOpener: Story = {
    render: () => <WithOpenerHarness />,
    play: async ({ canvasElement }) => {
        const link = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('a')
            if (!el) throw new Error('no note link mounted yet')
            return el
        })
        await userEvent.click(link)
        await waitFor(() => expect(canvasElement.textContent).toContain('opened: Morning pages.md'))

        const clear = Array.from(canvasElement.querySelectorAll('button')).find(b =>
            b.textContent?.includes('clear'),
        )
        if (!clear) throw new Error('no clear button')
        await userEvent.click(clear)
        await waitFor(() => expect(canvasElement.textContent).toContain('drill cleared'))
    },
}

/** No `onOpen` (no write target/opener, Review Focus #5) — rows render as plain text, not
 *  buttons or links. */
export const WithoutOpener: Story = {
    args: {
        title: 'Jul 20',
        rows: THREE_ROWS,
        onClear: () => {},
    },
}

/** A single row — the header reads `1 note`, singular. */
export const OneRow: Story = {
    args: {
        title: 'Jul 20',
        rows: [fileRow('Morning pages')],
        onOpen: () => {},
        onClear: () => {},
    },
}

/** 30 rows — scrolls past the 12-row max-height. */
export const ManyRows: Story = {
    args: {
        title: 'Jul 20',
        rows: THIRTY_ROWS,
        onOpen: () => {},
        onClear: () => {},
    },
}
