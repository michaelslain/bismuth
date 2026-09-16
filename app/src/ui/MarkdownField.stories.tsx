// Visual spec for <MarkdownField> — a standalone, always-live inline markdown editor
// bound to a plain string (value + onInput), with zero vault/file coupling. It reuses
// the same `livePreview` CodeMirror extension the note Editor uses, so bold/italic/
// lists/checkboxes/links render rendered-yet-editable, but omits wikilink/tag
// autocomplete, spell-check, math, and embeds — meant for a single small field
// (e.g. a calendar event's description), not a full note surface.
//
// Props: value + onInput (controlled), placeholder?, autofocus?, class?.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import MarkdownField from './MarkdownField'
import type { NoteCandidate } from '../editor/wikilink'

const meta = {
    title: 'UI/MarkdownField',
    component: MarkdownField,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof MarkdownField>

export default meta
type Story = StoryObj<typeof meta>

// The host owns the visible box (border/background/padding/min-height); MarkdownField
// itself is chromeless. This mirrors how a real call site (e.g. EventModal) would style it.
const fieldBoxStyle = {
    width: '360px',
    'min-height': '90px',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    'border-radius': '8px',
    background: 'var(--surface-1)',
} as const

function Controlled(props: {
    initial?: string
    placeholder?: string
    autofocus?: boolean
    noteNames?: () => NoteCandidate[]
    tagNames?: () => string[]
    notePath?: string | null
}) {
    const [v, setV] = createSignal(props.initial ?? '')
    return (
        <div style={fieldBoxStyle}>
            <MarkdownField
                value={v()}
                onInput={setV}
                placeholder={props.placeholder}
                autofocus={props.autofocus}
                noteNames={props.noteNames}
                tagNames={props.tagNames}
                notePath={props.notePath}
            />
        </div>
    )
}

const NOTE_NAMES: NoteCandidate[] = [
    { label: 'Lecture 7', path: 'Lecture 7.md' },
    { label: 'Lecture 8', path: 'Lecture 8.md' },
]

/** Empty field showing the placeholder. */
export const Placeholder: Story = {
    render: () => <Controlled placeholder="Add a description…" />,
}

/** Filled with live-preview markdown: bold/italic render inline, a checkbox is
 *  interactive, and a link shows as a link — all while remaining editable text. */
export const Filled: Story = {
    render: () => (
        <Controlled
            initial={
                '**Team sync** at 3pm — bring the _quarterly_ notes from [last week](https://example.com/notes).\n\n- [ ] Prep slides\n- [x] Book room'
            }
        />
    ),
}

/** Autofocused on mount (the field grabs the caret immediately). */
export const Autofocused: Story = {
    render: () => <Controlled initial="Focused on mount" autofocus />,
}

/** Typing `[[Lec` opens the SAME `[[wikilink]]` completion popup the note editor uses — proof
 *  that MarkdownField runs the shared `markdownEditingExtensions` stack wired to `noteNames`,
 *  not just that the prop compiles. Every candidate matching the prefix is offered. */
export const WikilinkCompletion: Story = {
    render: () => <Controlled noteNames={() => NOTE_NAMES} />,
    play: async ({ canvasElement }) => {
        const content = canvasElement.querySelector<HTMLElement>('.cm-content')
        if (!content) throw new Error('could not find .cm-content')
        await userEvent.click(content)
        // user-event's `type()` treats `[` as the start of a special-key escape, so a literal `[`
        // is written `[[` — typing the wikilink trigger `[[Lec` means passing `[[[[Lec`.
        await userEvent.type(content, '[[[[Lec')

        // CodeMirror mounts its completion tooltip on `document.body`, a sibling of the story
        // root — not a descendant of `canvasElement` — so the popup search has to go through the
        // owner document, the same reach `completionDisplay.ts`'s theme selectors assume.
        const doc = canvasElement.ownerDocument
        await waitFor(() => {
            if (!doc.querySelector('.cm-tooltip-autocomplete'))
                throw new Error('completion popup did not open')
        })
        const tooltip = doc.querySelector('.cm-tooltip-autocomplete')
        await expect(tooltip?.textContent).toContain('Lecture 7')
        await expect(tooltip?.textContent).toContain('Lecture 8')
    },
}

/** Seeds `**bold**` + a `[[wikilink]]` and proves the note editor's live-preview decorations are
 *  live here too: the wikilink renders as its bare basename, and the bold delimiters collapse to
 *  zero width off-cursor (`.cm-hidden-syntax` — never `display:none`, see livePreview.ts) rather
 *  than sitting in the doc as literal `**` text. */
export const RendersLivePreview: Story = {
    render: () => (
        <Controlled
            initial="**bold** and [[Lecture 7]]"
            noteNames={() => NOTE_NAMES}
        />
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('.cm-wikilink'))
                throw new Error('live-preview decorations not rendered yet')
        })
        await expect(
            canvasElement.querySelector('.cm-wikilink')?.textContent,
        ).toBe('Lecture 7')

        const hidden = canvasElement.querySelectorAll<HTMLElement>(
            '.cm-hidden-syntax',
        )
        await expect(hidden.length).toBeGreaterThan(0)
        for (const el of hidden) {
            await expect(el.getBoundingClientRect().width).toBeLessThan(0.5)
        }
    },
}
