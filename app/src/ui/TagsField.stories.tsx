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
function Harness(props: { initial: string[]; tags?: boolean; options?: string[] }) {
    const [value, setValue] = createSignal(props.initial)
    return (
        <div style={{ width: '280px' }}>
            <TagsField
                value={value()}
                suggestions={() => props.options ?? VAULT_TAGS}
                tags={props.tags}
                onCommit={setValue}
                onCancel={() => {}}
            />
        </div>
    )
}

/** Idle: the tags as a comma-separated line — `planning, docs, ` — caret at the end, ready for the
 *  next one, each tag drawn teal like ui/Tag. */
export const Idle: Story = {
    render: () => <Harness tags initial={['planning', 'docs']} />,
}

/** Typing `ch` pops the note editor's completion popup under the word: prefix matches, the
 *  first highlighted. */
export const TypingShowsSuggestions: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'ch')
        await expectCompletions(['chicken', 'chores'])
        expect(selectedCompletion()).toBe('chicken')
    },
}

/** Tab takes the highlighted suggestion (replacing the typed word with `#chicken `), Enter
 *  commits the whole list once. */
export const AcceptAndCommit: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'ch')
        await expectCompletions(['chicken', 'chores'])
        pressKey(view, 'ArrowDown')
        await waitFor(() => expect(selectedCompletion()).toBe('chores'))
        pressKey(view, 'Tab')
        await waitFor(() => expect(view.state.doc.toString()).toBe('planning, chores, '))
        expect(completionLabels()).toEqual([])
        // Enter commits and leaves the field — which then reads finished, no trailing separator.
        pressKey(view, 'Enter')
        await waitFor(() => expect(view.hasFocus).toBe(false))
        expect(view.state.doc.toString()).toBe('planning, chores')
    },
}

/** Escape with the popup open closes only the popup; a second Escape cancels the edit. */
export const EscapeClosesPopupThenCancels: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'fr')
        await expectCompletions(['frontend'])
        pressKey(view, 'Escape')
        await waitFor(() => expect(completionLabels()).toEqual([]))
        // Still editing: the popup closed, the typed word is still there.
        expect(view.hasFocus).toBe(true)
        expect(view.state.doc.toString()).toBe('planning, fr')
        pressKey(view, 'Escape')
        await waitFor(() => expect(view.hasFocus).toBe(false))
        expect(view.state.doc.toString()).toBe('planning')
    },
}

/** A declared multiselect: comma-separated (options may hold spaces), completions from its
 *  options only. */
export const Multiselect: Story = {
    render: () => (
        <Harness
            initial={['In progress']}
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
        await waitFor(() => expect(view.state.doc.toString()).toBe('planning, docs'))
        // A word with no suggestions, so no popup is open and Escape cancels straight away.
        typeInto(view, 'zzz')
        await waitFor(() => expect(view.state.doc.toString()).toBe('planning, docs, zzz'))
        expect(completionLabels()).toEqual([])
        await new Promise(r => setTimeout(r, 150)) // a person's pause, not a synthetic burst
        pressKey(view, 'Escape')
        await waitFor(() => expect(view.state.doc.toString()).toBe('planning, docs'))
    },
}

/** Tags keep their tag look while being typed: every value of a tag list is drawn teal like
 *  ui/Tag; a list that is not tags stays plain text. */
export const TagTokensKeepTheirLook: Story = {
    render: () => <Harness tags initial={['planning', 'docs']} />,
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'area/research')
        await waitFor(() => {
            const tokens = [...view.contentDOM.querySelectorAll('.cm-line span')]
            expect(tokens.map(t => t.textContent)).toEqual([
                'planning',
                'docs',
                'area/research',
            ])
            for (const t of tokens)
                expect(getComputedStyle(t).color).toBe(getComputedStyle(tokens[0]!).color)
            expect(getComputedStyle(tokens[0]!).color).not.toBe(
                getComputedStyle(view.contentDOM).color,
            )
        })
    },
}

/** An owner that does NOT feed a commit back in (the row editor keeps its row static): Escape on
 *  a later edit must revert to what the field last committed, never to the value it was first
 *  handed — reverting past a commit would silently drop it on the next save. */
export const OwnerIgnoresCommit: Story = {
    render: () => (
        <div style={{ width: '280px' }}>
            <TagsField
                value={['planning']}
                suggestions={() => VAULT_TAGS}
                onCommit={() => {}}
                onCancel={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'zzz')
        pressKey(view, 'Enter')
        await waitFor(() => expect(view.state.doc.toString()).toBe('planning, zzz'))
        typeInto(view, 'yyy')
        await new Promise(r => setTimeout(r, 150))
        pressKey(view, 'Escape')
        await waitFor(() => expect(view.state.doc.toString()).toBe('planning, zzz'))
    },
}
