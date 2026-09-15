// app/src/ui/InlineTextInput.stories.tsx
// The inline-rename input shared by the file tree (EditableLabel) and the PDF bookmarks panel.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import InlineTextInput from './InlineTextInput'
import Text from './Text'

let commits: string[] = []
let cancels = 0

const meta = {
    title: 'UI/InlineTextInput',
    component: InlineTextInput,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof InlineTextInput>

export default meta
type Story = StoryObj<typeof meta>

const input = (root: HTMLElement) =>
    root.querySelector('input') as HTMLInputElement

const key = (el: HTMLElement, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

/** Mounts focused with its text selected; Enter commits the trimmed text exactly once, even
 *  though the unmount that follows fires blur. */
export const CommitsOnce: Story = {
    render: () => {
        commits = []
        cancels = 0
        const [editing, setEditing] = createSignal(true)
        return (
            <div style={{ width: '220px' }}>
                <Text size="ui" tone="muted">
                    Rename
                </Text>
                <Show
                    when={editing()}
                    fallback={<span data-testid="done">done</span>}
                >
                    <InlineTextInput
                        value="Chapter 2"
                        label="Name"
                        onCommit={v => {
                            commits.push(v)
                            setEditing(false)
                        }}
                        onCancel={() => {
                            cancels++
                            setEditing(false)
                        }}
                    />
                </Show>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const el = input(canvasElement)
        await waitFor(() => expect(document.activeElement).toBe(el))
        await expect(el.selectionStart).toBe(0)
        await expect(el.selectionEnd).toBe('Chapter 2'.length)
        el.value = '  Results '
        key(el, 'Enter')
        el.dispatchEvent(new FocusEvent('blur'))
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="done"]'),
            ).not.toBeNull(),
        )
        await expect(commits).toEqual(['Results'])
        await expect(cancels).toBe(0)
    },
}

/** Escape cancels exactly once. The input is deliberately LEFT MOUNTED after cancelling (a caller
 *  that doesn't unmount it), so a second Escape, a blur and a late Enter all still reach its
 *  handlers — and none of them may report anything again. */
export const EscapeCancels: Story = {
    render: () => {
        commits = []
        cancels = 0
        return (
            <div style={{ width: '220px' }}>
                <Text size="ui" tone="muted">
                    Rename
                </Text>
                <InlineTextInput
                    value="Chapter 2"
                    onCommit={v => commits.push(v)}
                    onCancel={() => cancels++}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const el = input(canvasElement)
        el.value = 'changed'
        key(el, 'Escape')
        key(el, 'Escape')
        el.dispatchEvent(new FocusEvent('blur'))
        key(el, 'Enter')
        await expect(cancels).toBe(1)
        await expect(commits).toEqual([])
    },
}
