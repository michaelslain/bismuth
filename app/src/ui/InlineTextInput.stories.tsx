// app/src/ui/InlineTextInput.stories.tsx
// The inline-rename input shared by the file tree (EditableLabel) and the PDF bookmarks panel.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import InlineTextInput from './InlineTextInput'
import { Modal } from './Modal'
import Text from './Text'
import { settings, setSettings } from '../settings'

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
        // Focused, it shows its own accent-coloured `outline` — never the browser's own blue
        // focus ring drawn on top of the accent border, and never a `box-shadow`-only ring, which
        // forced-colors mode drops entirely (fix 3 finding 7).
        const cs = getComputedStyle(el)
        const accent = (() => {
            const probe = document.createElement('div')
            probe.style.color = 'var(--accent)'
            canvasElement.appendChild(probe)
            const c = getComputedStyle(probe).color
            probe.remove()
            return c
        })()
        await expect(el.matches(':focus')).toBe(true)
        await expect(cs.outlineStyle).not.toBe('none')
        await expect(parseFloat(cs.outlineWidth)).toBeGreaterThan(0)
        await expect(cs.outlineColor).toBe(accent)
        await expect(cs.borderTopColor).toBe(accent)
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

/** `ui-confirm`/`ui-dismiss` (settings.keybindings) are rebindable — proves the input reads
 *  through widgetKeys.ts's isConfirmKey/isDismissKey rather than a hardcoded `e.key` check.
 *  Once rebound, the plain Enter/Escape this component used to hardcode no longer fire, and
 *  only the new combo does. */
export const RebindableKeys: Story = {
    render: () => {
        commits = []
        cancels = 0
        return (
            <div style={{ width: '220px' }}>
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
        const savedConfirm = settings.keybindings['ui-confirm']
        const savedDismiss = settings.keybindings['ui-dismiss']
        try {
            setSettings('keybindings', 'ui-confirm', 'Mod+Enter')
            setSettings('keybindings', 'ui-dismiss', 'Mod+.')
            // Plain Enter/Escape no longer fire once rebound away from them.
            key(el, 'Enter')
            key(el, 'Escape')
            await expect(commits).toEqual([])
            await expect(cancels).toBe(0)
            // The new combo does.
            el.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    metaKey: true,
                    bubbles: true,
                }),
            )
            await expect(commits).toEqual(['Chapter 2'])
        } finally {
            setSettings('keybindings', 'ui-confirm', savedConfirm)
            setSettings('keybindings', 'ui-dismiss', savedDismiss)
        }
    },
}

/** An InlineTextInput inside a Modal: Escape cancels the rename and leaves the Modal open (the
 *  input marks the key consumed with `preventDefault`); Escape from outside the input then
 *  closes the Modal. */
export const EscapeInsideModal: Story = {
    parameters: { layout: 'fullscreen' },
    render: () => {
        commits = []
        cancels = 0
        const [modalOpen, setModalOpen] = createSignal(true)
        const [editing, setEditing] = createSignal(true)
        return (
            <>
                <span data-testid="modal-state">{modalOpen() ? 'open' : 'closed'}</span>
                {modalOpen() && (
                    <Modal label="Rename host" onClose={() => setModalOpen(false)}>
                        <div style={{ padding: '24px', background: 'var(--surface-1)', width: '260px' }}>
                            <Show when={editing()} fallback={<span data-testid="cancelled">cancelled</span>}>
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
                    </Modal>
                )}
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const body = canvasElement.ownerDocument.body
        const state = () => body.querySelector('[data-testid="modal-state"]')!
        const el = await waitFor(() => {
            const i = body.querySelector('input[aria-label="Name"]') as HTMLInputElement
            expect(i).not.toBeNull()
            return i
        })
        await waitFor(() => expect(document.activeElement).toBe(el))
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(cancels).toBe(1))
        await expect(state().textContent).toBe('open')
        await expect(body.querySelector('[data-testid="cancelled"]')).not.toBeNull()
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(state().textContent).toBe('closed'))
    },
}
