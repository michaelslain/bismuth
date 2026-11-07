// Visual spec for <BlockCopyButton> — the copy glyph a note block wears: inside a code block's
// header (CodeHeader) and at the right end of a quote's first line. `QuoteInNote` mounts the real
// live preview over a note with quotes, the host a note and a chat message both render through.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { markdown } from '@codemirror/lang-markdown'
import BlockCopyButton from './BlockCopyButton'
import { CmHarness } from './_cmHarness'
import { livePreview } from '../editor/livePreview'
import { stubClipboard } from './_clipboardStub'
import { ToastHost } from './ToastHost'

const meta = {
    title: 'Editor/BlockCopyButton',
    component: BlockCopyButton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BlockCopyButton>

export default meta
type Story = StoryObj<typeof meta>

/** The bare glyph: muted at rest, accent on hover. Clicking writes `text` and toasts "Copied". */
export const Default: Story = {
    render: () => (
        <div>
            <BlockCopyButton text="copied text" label="Copy quote" />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const clip = stubClipboard()
        await userEvent.click(
            within(canvasElement).getByRole('button', { name: 'Copy quote' }),
        )
        await waitFor(() => expect(clip.written()).toEqual(['copied text']))
        clip.restore()
        ;(document.activeElement as HTMLElement | null)?.blur()
    },
}

const NOTE = [
    'Prose above the quotes.',
    '',
    '> The best way to predict the future is to invent it, and the second best way is to write',
    '> it down in a note you will actually read again.',
    '>',
    '> > A nested quote inside it.',
    '',
    'Prose between.',
    '',
    '> One short line.',
    '',
    '> [!note] A callout',
    '> A callout wears its own copy button on its title row, not a quote one.',
    '',
].join('\n')

/** In its host: a note's live preview, caret elsewhere. Each quote shows one copy button at the
 *  right of its first line; the callout wears its own on its title row. The first button copies the whole first quote
 *  with one level of `>` removed. */
export const QuoteInNote: Story = {
    render: () => (
        <div style={{ height: '360px', width: '520px' }}>
            <CmHarness doc={NOTE} extensions={[markdown(), livePreview]} />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const clip = stubClipboard()
        const buttons = await waitFor(() => {
            const found = within(canvasElement).getAllByRole('button', {
                name: 'Copy quote',
            })
            expect(found).toHaveLength(2)
            return found
        })
        await userEvent.click(buttons[0])
        await waitFor(() =>
            expect(clip.written()).toEqual([
                'The best way to predict the future is to invent it, and the second best way is to write\n' +
                    'it down in a note you will actually read again.\n' +
                    '\n' +
                    '> A nested quote inside it.',
            ]),
        )
        await waitFor(() =>
            expect(
                within(canvasElement).getByText('Copied'),
            ).toBeInTheDocument(),
        )
        clip.restore()
        ;(document.activeElement as HTMLElement | null)?.blur()
    },
}

const CALLOUT_NOTE = [
    'Prose above.',
    '',
    '> [!tip] Keep it short',
    '> A callout copies its body, not its title line.',
    '> Second body line.',
    '',
    '> [!warning]- Folded until opened',
    '> Clicking copy on a foldable callout does not open or close it.',
    '',
].join('\n')

/** Callouts in a note: the copy button sits at the right of the title row and copies the body
 *  without its `>` markers. On a foldable callout the click copies without toggling it. */
export const CalloutInNote: Story = {
    render: () => (
        <div style={{ height: '260px', width: '520px' }}>
            <CmHarness doc={CALLOUT_NOTE} extensions={[markdown(), livePreview]} />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const clip = stubClipboard()
        const buttons = await waitFor(() => {
            const found = within(canvasElement).getAllByRole('button', {
                name: 'Copy callout',
            })
            expect(found).toHaveLength(2)
            return found
        })
        await userEvent.click(buttons[0])
        await waitFor(() =>
            expect(clip.written()).toEqual([
                'A callout copies its body, not its title line.\nSecond body line.',
            ]),
        )
        const folded = buttons[1].closest('details')
        expect(folded?.open).toBe(false)
        await userEvent.click(buttons[1])
        await waitFor(() => expect(clip.written()).toHaveLength(2))
        expect(folded?.open).toBe(false)
        clip.restore()
        ;(document.activeElement as HTMLElement | null)?.blur()
    },
}
