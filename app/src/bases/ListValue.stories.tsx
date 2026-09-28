// Visual spec for <ListValue> — a tags or multiselect property as one line of text with the note
// editor's completion popup. Each play commits through the harness and asserts the list written.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import ListValue, { resetVaultTagsCache, type ListValueProps } from './ListValue'
import {
    expectCompletions,
    pressKey,
    tagsFieldView,
    typeInto,
} from '../ui/_tagsFieldPlay'

const meta = {
    title: 'Bases/ListValue',
    component: ListValue,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ListValue>

export default meta
type Story = StoryObj<typeof meta>

const Harness = (p: { kind: ListValueProps['kind']; initial: unknown }) => {
    const [value, setValue] = createSignal<unknown>(p.initial)
    const [committed, setCommitted] = createSignal('none')
    resetVaultTagsCache()
    return (
        <div style={{ width: '260px' }}>
            <ListValue
                kind={p.kind}
                value={value()}
                autofocus={false}
                onCommit={v => {
                    setValue(v)
                    setCommitted(JSON.stringify(v))
                }}
                onCancel={() => setCommitted('cancelled')}
            />
            <span hidden data-testid="committed">
                {committed()}
            </span>
        </div>
    )
}

export const MultiselectPartial: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'multiselect', options: ['planning', 'frontend', 'docs'] }}
            initial={['planning', 'frontend']}
        />
    ),
}

export const Tags: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'tags', options: ['frontend', 'bug'], tag: true }}
            initial={['frontend', 'bug']}
        />
    ),
}

/** Type the start of an option, Tab takes it, Enter commits the whole list once. */
export const MultiselectTypeTabEnter: Story = {
    render: () => (
        <Harness
            kind={{ kind: 'multiselect', options: ['planning', 'frontend', 'docs'] }}
            initial={['planning']}
        />
    ),
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        typeInto(view, 'f')
        await expectCompletions(['frontend'])
        pressKey(view, 'Tab')
        await waitFor(() => expect(view.state.doc.toString()).toBe('planning, frontend, '))
        pressKey(view, 'Enter')
        await expect(within(canvasElement).getByTestId('committed')).toHaveTextContent(
            '["planning","frontend"]',
        )
    },
}

/** Emptying the field commits null, not a bare empty list. */
export const EmptyCommitsNull: Story = {
    render: () => (
        <Harness kind={{ kind: 'tags', options: ['bug'], tag: false }} initial={['bug']} />
    ),
    play: async ({ canvasElement }) => {
        const view = await tagsFieldView(canvasElement)
        view.focus() // leaving the field is what commits, so it has to hold focus first
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '' },
            userEvent: 'delete',
        })
        pressKey(view, 'Enter')
        await waitFor(() =>
            expect(within(canvasElement).getByTestId('committed')).toHaveTextContent('null'),
        )
    },
}
