// Visual spec for <PathField> — a path input with a browse button. The browse handler is the
// caller's (the native dialog is desktop-only), so the stories stand one in that just fills the
// field, which is the whole contract.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import PathField from './PathField'

const meta = {
    title: 'UI/PathField',
    component: PathField,
    parameters: { layout: 'centered' },
    args: { value: '', onInput: () => {}, onBrowse: () => {} },
} satisfies Meta<typeof PathField>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: any }) => (
    <div style={{ width: '360px' }}>{props.children}</div>
)

/** Empty, showing the placeholder. */
export const Empty: Story = {
    render: () => {
        const [v, setV] = createSignal('')
        return (
            <Frame>
                <PathField
                    value={v()}
                    onInput={setV}
                    onBrowse={() => setV('notes/idea.md')}
                    placeholder="vault-relative path, e.g. notes/idea.md"
                    label="input path"
                />
            </Frame>
        )
    },
}

/** Filled, and a long path: the input shrinks (min-width 0), the button never does. */
export const LongPath: Story = {
    render: () => {
        const [v, setV] = createSignal(
            'projects/2026/q4/planning/roadmap-review-notes-for-the-whole-team.md',
        )
        return (
            <Frame>
                <PathField
                    value={v()}
                    onInput={setV}
                    onBrowse={() => {}}
                    label="input path"
                />
            </Frame>
        )
    },
}

/** The commit gesture: Enter applies the typed path, and so does leaving the field. */
export const CommitOnEnter: Story = {
    render: () => {
        const [v, setV] = createSignal('')
        const [committed, setCommitted] = createSignal('(nothing yet)')
        return (
            <Frame>
                <PathField
                    value={v()}
                    onInput={setV}
                    onCommit={() => setCommitted(v())}
                    onBrowse={() => {}}
                    placeholder="type a path"
                    label="input path"
                />
                <div data-testid="committed">{committed()}</div>
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const input = c.getByLabelText('input path')
        await userEvent.type(input, 'a/b.md{enter}')
        await expect(c.getByTestId('committed').textContent).toBe('a/b.md')
    },
}
