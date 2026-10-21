// Visual spec for <CodeHeader> — the ```lang label + copy button a fenced code block wears in a
// note (live preview, cursor outside the block) and in a chat message (ui/CodeFence). Its look is
// its own stylesheet, so the bare stories render the real thing; `InNote` mounts the real live
// preview over a fence to show it in its host row.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { markdown } from '@codemirror/lang-markdown'
import CodeHeader from './CodeHeader'
import { CmHarness } from './_cmHarness'
import { livePreview } from '../editor/livePreview'
import { stubClipboard } from './_clipboardStub'
import { ToastHost } from './ToastHost'

const meta = {
    title: 'Editor/CodeHeader',
    component: CodeHeader,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CodeHeader>

export default meta
type Story = StoryObj<typeof meta>

// The fence row this header rides: a --code-bg band at the code size.
const rowStyle = {
    width: '360px',
    padding: 'var(--sp-3) var(--sp-5)',
    background: 'var(--code-bg)',
    'font-size': 'var(--code-font-size)',
} as const

/** A TypeScript block's header: dim "```typescript" label + copy button. Clicking copies the body. */
export const Default: Story = {
    render: () => (
        <div style={rowStyle}>
            <CodeHeader lang="typescript" body={'export const x = 1'} />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const clip = stubClipboard()
        await userEvent.click(
            within(canvasElement).getByRole('button', { name: 'Copy code' }),
        )
        await waitFor(() => expect(clip.written()).toEqual(['export const x = 1']))
        await waitFor(() => expect(within(canvasElement).getByText('Copied')).toBeInTheDocument())
        clip.restore()
        // Leave the story at rest: no focused copy button still showing.
        ;(document.activeElement as HTMLElement | null)?.blur()
    },
}

/** No language on the fence (a bare ``` block): the label is the bare fence. */
export const NoLanguage: Story = {
    render: () => (
        <div style={rowStyle}>
            <CodeHeader lang="" body={'echo hello'} />
            <ToastHost />
        </div>
    ),
}

const NOTE = [
    'Prose above.',
    '',
    '```ts',
    'const a = 1',
    'export const sum = a + 2',
    '```',
    '',
    'Prose below.',
    '',
].join('\n')

/** In its host: a note's live preview over a fenced block, caret elsewhere. */
export const InNote: Story = {
    render: () => (
        <div style={{ height: '220px', width: '560px' }}>
            <CmHarness doc={NOTE} extensions={[markdown(), livePreview]} />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const clip = stubClipboard()
        const button = await waitFor(() =>
            within(canvasElement).getByRole('button', { name: 'Copy code' }),
        )
        await userEvent.click(button)
        await waitFor(() =>
            expect(clip.written()).toEqual(['const a = 1\nexport const sum = a + 2']),
        )
        await waitFor(() => expect(within(canvasElement).getByText('Copied')).toBeInTheDocument())
        clip.restore()
        // Leave the story at rest: no focused copy button still showing.
        ;(document.activeElement as HTMLElement | null)?.blur()
    },
}
