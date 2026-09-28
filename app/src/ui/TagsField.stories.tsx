// Visual spec for <TagsField> — the single-line field a tags / multiselect property is typed in,
// like a note's frontmatter `tags:` line, with the note editor's own completion popup under the
// word being typed. Every story holds real state: a commit becomes the field's value, which is what
// Escape reverts to next time.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import TagsField from './TagsField'
import {
    completionLabels,
    expectCompletions,
    pressKey,
    selectedCompletion,
    tagsFieldView,
    typeInto,
} from './_tagsFieldPlay'

const meta = {
    title: 'UI/TagsField',
    component: TagsField,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TagsField>

export default meta
type Story = StoryObj<typeof meta>

const VAULT_TAGS = ['planning', 'chicken', 'chores', 'frontend', 'docs', 'launch']

/** The field holding its own value: a commit replaces it, a cancel reverts to it. */
function Harness(props: { initial: string[]; hash?: boolean; options?: string[] }) {
    const [value, setValue] = createSignal(props.initial)
    return (
        <div style={{ width: '280px' }}>
            <TagsField
                value={value()}
                suggestions={() => props.options ?? VAULT_TAGS}
                hash={props.hash}
                onCommit={setValue}
                onCancel={() => {}}
            />
        </div>
    )
}

/** Idle: the tags as text — `#planning #docs ` — caret at the end, ready for the next one. */
export const Idle: Story = {
    render: () => <Harness initial={['planning', 'docs']} />,
}

/** Typing `ch` pops the note editor's completion popup under the word: prefix matches, the
 *  first highlighted. */
export const TypingShowsSuggestions: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'ch')
        await expectCompletions(['#chicken', '#chores'])
        expect(selectedCompletion()).toBe('#chicken')
    },
}

/** Tab takes the highlighted suggestion (replacing the typed word with `#chicken `), Enter
 *  commits the whole list once. */
export const AcceptAndCommit: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'ch')
        await expectCompletions(['#chicken', '#chores'])
        pressKey(view, 'ArrowDown')
        await waitFor(() => expect(selectedCompletion()).toBe('#chores'))
        pressKey(view, 'Tab')
        await waitFor(() => expect(view.state.doc.toString()).toBe('#planning #chores '))
        expect(completionLabels()).toEqual([])
        // Enter commits and leaves the field — which then reads finished, no trailing separator.
        pressKey(view, 'Enter')
        await waitFor(() => expect(view.hasFocus).toBe(false))
        expect(view.state.doc.toString()).toBe('#planning #chores')
    },
}

/** Escape with the popup open closes only the popup; a second Escape cancels the edit. */
export const EscapeClosesPopupThenCancels: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'fr')
        await expectCompletions(['#frontend'])
        pressKey(view, 'Escape')
        await waitFor(() => expect(completionLabels()).toEqual([]))
        // Still editing: the popup closed, the typed word is still there.
        expect(view.hasFocus).toBe(true)
        expect(view.state.doc.toString()).toBe('#planning fr')
        pressKey(view, 'Escape')
        await waitFor(() => expect(view.hasFocus).toBe(false))
        expect(view.state.doc.toString()).toBe('#planning')
    },
}

/** A declared multiselect: comma-separated (options may hold spaces), completions from its
 *  options only. */
export const Multiselect: Story = {
    render: () => (
        <Harness
            initial={['In progress']}
            hash={false}
            options={['In progress', 'Blocked', 'Done']}
        />
    ),
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        expect(view.state.doc.toString()).toBe('In progress, ')
        typeInto(view, 'b')
        await expectCompletions(['Blocked'])
    },
}

/** The field can stay mounted after an edit ends (the card modal keeps every field), so a second
 *  edit in the same field must work too — and a cancel reverts to the value the FIRST edit
 *  committed, proving that commit reached the field's owner. */
export const EditsTwice: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'docs')
        pressKey(view, 'Enter')
        await waitFor(() => expect(view.state.doc.toString()).toBe('#planning #docs'))
        // A word with no suggestions, so no popup is open and Escape cancels straight away.
        typeInto(view, 'zzz')
        await waitFor(() => expect(view.state.doc.toString()).toBe('#planning #docs zzz'))
        expect(completionLabels()).toEqual([])
        await new Promise(r => setTimeout(r, 150)) // a person's pause, not a synthetic burst
        pressKey(view, 'Escape')
        await waitFor(() => expect(view.state.doc.toString()).toBe('#planning #docs'))
    },
}

/** Tags keep their tag look while being typed: every `#tag` token is drawn teal like ui/Tag. */
export const TagTokensKeepTheirLook: Story = {
    render: () => <Harness initial={['planning', 'docs']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, '#launch')
        await waitFor(() => {
            const tokens = [...view.contentDOM.querySelectorAll('span')].filter(el =>
                /^#\S+$/.test(el.textContent ?? ''),
            )
            expect(tokens.map(t => t.textContent)).toEqual(['#planning', '#docs', '#launch'])
            const teal = getComputedStyle(document.documentElement)
                .getPropertyValue('--teal')
                .trim()
            expect(teal).not.toBe('')
            for (const t of tokens)
                expect(getComputedStyle(t).color).toBe(getComputedStyle(tokens[0]!).color)
            expect(getComputedStyle(tokens[0]!).color).not.toBe(
                getComputedStyle(view.contentDOM).color,
            )
        })
    },
}
