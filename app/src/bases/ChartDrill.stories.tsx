// Visual spec for <ChartDrill> — the note list opened under a chart when a bucket is clicked.
// "With opener" holds real state: clicking `[ clear ]` actually hides the drill, same as a bucket
// click would in a real chart view.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show } from 'solid-js'
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

/** Real state: clicking `[ clear ]` sets `open` false and the drill disappears. */
function WithOpenerHarness() {
    const [open, setOpen] = createSignal(true)
    return (
        <Show
            when={open()}
            fallback={<div>drill cleared — click a bucket again to reopen</div>}
        >
            <ChartDrill
                title="Jul 20"
                rows={THREE_ROWS}
                onOpen={path => window.alert(`open ${path}`)}
                onClear={() => setOpen(false)}
            />
        </Show>
    )
}

export const WithOpener: Story = {
    render: () => <WithOpenerHarness />,
}

/** No `onOpen` (no write target/opener, Review Focus #5) — rows render as plain text, not
 *  buttons. */
export const WithoutOpener: Story = {
    args: {
        title: 'Jul 20',
        rows: THREE_ROWS,
        onClear: () => {},
    },
}

/** 30 rows — scrolls past the 12-row max-height. */
export const ManyRows: Story = {
    args: {
        title: 'Jul 20',
        rows: THIRTY_ROWS,
        onOpen: (path: string) => window.alert(`open ${path}`),
        onClear: () => {},
    },
}
