// Visual spec for <TranscriptPage> — one page of a transcript as a note-style markdown field under
// a divider row. Status cells here are plain Text; PageStatus (Task 5) owns the real cell.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import TranscriptPage, { type TranscriptPageHandle } from './TranscriptPage'
import Text from '../ui/Text'
import type { TranscriptCheck } from '../../../core/src/transcript'

const meta = {
    title: 'Bases/TranscriptPage',
    component: TranscriptPage,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof TranscriptPage>

export default meta
type Story = StoryObj<typeof meta>

const PROSE = `Dear diary, the ==integral of $x^2$== is $x^3/3$ plus a constant.

## The second day

- one thing to remember
- another, with **bold** words

| a | b |
|---|---|
| 1 | 2 |

$$\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$$`

const shell = { width: '620px' } as const

function Harness(props: { text?: string; label?: string; status?: string; tone?: 'muted' | 'danger'; readOnly?: boolean; onHandle?: (h: TranscriptPageHandle) => void }) {
    const [saves, setSaves] = createSignal<string[]>([])
    return (
        <div style={shell} data-saves={saves().length} data-last={saves().at(-1) ?? ''}>
            <TranscriptPage
                label={props.label}
                text={props.text ?? ''}
                readOnly={props.readOnly}
                ref={props.onHandle}
                onSave={t => setSaves(s => [...s, t])}
                status={props.status ? <Text as="span" size="ui" tone={props.tone ?? 'muted'}>{props.status}</Text> : undefined}
            />
        </div>
    )
}

export const Prose: Story = {
    render: () => <Harness label="page 3" status="on-device" text={PROSE} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('.cm-content')).not.toBeNull())
        // the mark is tinted and its delimiters hidden while the caret is elsewhere
        await waitFor(() => expect(canvasElement.querySelector('.cm-tr-mark')).not.toBeNull())
        expect(canvasElement.querySelector('.cm-tr-mark')!.textContent).toContain('integral of')
        expect(canvasElement.textContent).not.toContain('==integral')
    },
}

export const Empty: Story = {
    render: () => <Harness label="page 4" status="queued" text="" />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('.cm-placeholder')?.textContent).toBe('no text yet'))
    },
}

export const StatusReading: Story = { render: () => <Harness label="page 5" status="reading // math reader" text="" /> }
export const StatusFailed: Story = { render: () => <Harness label="page 6" status="failed // timed out" tone="danger" text="" /> }
export const StatusNotTranscribed: Story = { render: () => <Harness label="page 7" status="not transcribed" text="" /> }
export const NamedInBook: Story = { render: () => <Harness label="lecture-2.pdf // page 12" status="ai" text="Short text." /> }
export const ImageNoDivider: Story = { render: () => <Harness text="Text read from a photo, with no page divider above it." /> }
export const ReadOnly: Story = { render: () => <Harness label="page 1" readOnly text={PROSE} /> }

// onSave: once per pause, with the new text; never for text the reader did not change.
export const SavesOncePerPause: Story = {
    render: () => <Harness label="page 1" text="alpha" />,
    play: async ({ canvasElement }) => {
        const root = canvasElement.querySelector<HTMLElement>('[data-saves]')!
        const content = await waitFor(() => {
            const c = canvasElement.querySelector<HTMLElement>('.cm-content')
            if (!c) throw new Error('no editor')
            return c
        })
        await new Promise(r => setTimeout(r, 900))
        expect(root.dataset.saves).toBe('0')
        await userEvent.click(content)
        await userEvent.keyboard('{End} beta')
        await waitFor(() => expect(root.dataset.saves).toBe('1'), { timeout: 2000 })
        expect(root.dataset.last).toBe('alpha beta')
        await new Promise(r => setTimeout(r, 900))
        expect(root.dataset.saves).toBe('1')
    },
}

// toggleMark wraps then unwraps; reveal puts the caret at the text and flashes it.
let handle: TranscriptPageHandle | undefined
export const MarkAndReveal: Story = {
    render: () => <Harness label="page 2" text="the quick brown fox jumps" onHandle={h => (handle = h)} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(handle).toBeDefined())
        const h = handle!
        const content = canvasElement.querySelector<HTMLElement>('.cm-content')!
        // no selection: nothing happens
        h.toggleMark()
        expect(content.textContent).toBe('the quick brown fox jumps')
        h.reveal('brown')
        await waitFor(() => expect(canvasElement.querySelector('.cm-tr-flash')?.textContent).toBe('brown'))
        // select "brown" via keyboard: caret is at its start
        await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}')
        expect(h.selection()).toBe('brown')
        h.toggleMark()
        await waitFor(() => expect(canvasElement.querySelector('.cm-tr-mark')?.textContent).toBe('brown'))
        // the selection touches the mark, so its delimiters show
        expect(content.textContent).toBe('the quick ==brown== fox jumps')
        // the selection is inside the mark: toggling again unwraps
        h.toggleMark()
        await waitFor(() => expect(canvasElement.querySelector('.cm-tr-mark')).toBeNull())
        expect(content.textContent).toBe('the quick brown fox jumps')
    },
}

// A text change from outside is not an undo step: Mod-Z leaves it, and nothing is saved.
let setOuter: ((t: string) => void) | undefined
export const ExternalTextNotUndoable: Story = {
    render: () => {
        const [text, setText] = createSignal('first')
        const [saves, setSaves] = createSignal(0)
        setOuter = setText
        return (
            <div style={shell} data-saves={saves()}>
                <TranscriptPage label="page 1" text={text()} onSave={() => setSaves(n => n + 1)} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const content = await waitFor(() => {
            const c = canvasElement.querySelector<HTMLElement>('.cm-content')
            if (!c) throw new Error('no editor')
            return c
        })
        setOuter?.('the transcription arrived')
        await waitFor(() => expect(content.textContent).toContain('the transcription arrived'))
        await userEvent.click(content)
        await userEvent.keyboard('{Meta>}z{/Meta}')
        await userEvent.keyboard('{Control>}z{/Control}')
        await new Promise(r => setTimeout(r, 900))
        expect(content.textContent).toContain('the transcription arrived')
        expect(canvasElement.querySelector<HTMLElement>('[data-saves]')!.dataset.saves).toBe('0')
    },
}

/** Review checks with live state: approving a check drops it, retyping its line drops it too. */
function CheckedHarness() {
    const [checks, setChecks] = createSignal<TranscriptCheck[]>([
        { line: 'to frnot only the esentail facts of lfie', level: 'garbled' },
        { line: 'and see if I could not learn what it had to teech', level: 'unsure' },
    ])
    return (
        <div style={shell}>
            <TranscriptPage
                label="page 1"
                text={'I went to the woods because I wished to live deliberately\nto frnot only the esentail facts of lfie\nand see if I could not learn what it had to teech'}
                checks={checks()}
                onApprove={line => setChecks(cs => cs.filter(c => c.line !== line))}
                onSave={() => {}}
            />
        </div>
    )
}

export const WithChecks: Story = {
    name: 'With checks',
    render: () => <CheckedHarness />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-transcript-check]').length).toBe(2))
        const glyph = canvasElement.querySelector<HTMLElement>('[data-transcript-check="unsure"]')!
        glyph.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
        await waitFor(() => expect(document.querySelector('[data-check-popover]')).not.toBeNull())
        await userEvent.click(document.querySelector<HTMLElement>('[data-check-approve]')!)
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-transcript-check]').length).toBe(1))
    },
}

/** A page the reader returned nothing for: a red glyph beside the label. */
export const EmptyPageCheck: Story = {
    name: 'Empty page check',
    render: () => (
        <div style={shell}>
            <TranscriptPage label="page 2" text="" checks={[{ line: '', level: 'garbled' }]} onSave={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelector('[data-page-check="garbled"]')).not.toBeNull()
    },
}
