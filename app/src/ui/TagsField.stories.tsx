// Visual spec for <TagsField> — the single-line field a tags / multiselect property is typed in,
// like a note's frontmatter `tags:` line, with the note editor's own completion popup under the
// word being typed. Every story holds real state: what the field commits shows under it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor, within } from 'storybook/test'
import TagsField from './TagsField'
import Text from './Text'
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

/** A field plus a readout of what it last committed — the state a person would see change. */
function Harness(props: { initial: string[]; hash?: boolean; options?: string[] }) {
    const [value, setValue] = createSignal(props.initial)
    const [status, setStatus] = createSignal('editing')
    return (
        <div style={{ width: '280px', display: 'grid', gap: '12px' }}>
            <TagsField
                value={value()}
                suggestions={() => props.options ?? VAULT_TAGS}
                hash={props.hash}
                onCommit={next => {
                    setValue(next)
                    setStatus(`committed: ${JSON.stringify(next)}`)
                }}
                onCancel={() => setStatus('cancelled')}
            />
            <Text tone="muted">{status()}</Text>
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
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'ch')
        await expectCompletions(['#chicken', '#chores'])
        pressKey(view, 'ArrowDown')
        await waitFor(() => expect(selectedCompletion()).toBe('#chores'))
        pressKey(view, 'Tab')
        await waitFor(() => expect(view.state.doc.toString()).toBe('#planning #chores '))
        expect(completionLabels()).toEqual([])
        pressKey(view, 'Enter')
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["planning","chores"]',
        )
    },
}

/** Escape with the popup open closes only the popup; a second Escape cancels the edit. */
export const EscapeClosesPopupThenCancels: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'fr')
        await expectCompletions(['#frontend'])
        pressKey(view, 'Escape')
        await waitFor(() => expect(completionLabels()).toEqual([]))
        expect(canvas.getByText('editing')).toBeInTheDocument()
        pressKey(view, 'Escape')
        await expect(canvas.getByText('cancelled')).toBeInTheDocument()
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
 *  edit in the same field must commit too: add a tag, Enter; add another, Enter. */
export const EditsTwice: Story = {
    render: () => <Harness initial={['planning']} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'docs')
        pressKey(view, 'Enter')
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["planning","docs"]',
        )
        // Left finished: no dangling separator once the field has lost focus.
        expect(view.state.doc.toString()).toBe('#planning #docs')
        typeInto(view, 'launch')
        await waitFor(() =>
            expect(view.state.doc.toString()).toBe('#planning #docs launch'),
        )
        pressKey(view, 'Enter')
        await expect(canvas.getByText(/committed:/)).toHaveTextContent(
            '["planning","docs","launch"]',
        )
    },
}
