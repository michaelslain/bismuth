// Visual spec for buttonBlock.ts — the ```button embedded block in a note: a single button, a row,
// an invalid fence, and the revealed source. A fake runtime stands in for the real one (states are
// always idle); the note path comes from notePathFacet as Editor.tsx provides it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import { CmHarness } from '../ui/_cmHarness'
import { buttonBlock } from './buttonBlock'
import { notePathFacet } from './tableState'
import {
    buttonKey,
    parseButtonBlock,
} from '../../../core/src/buttons/buttonBlock'
import { setButtonRuntime } from '../buttons/buttonRuntime'

const meta = {
    title: 'Editor/ButtonBlock',
    parameters: { layout: 'fullscreen' },
    beforeEach: () => {
        setButtonRuntime({
            parse: parseButtonBlock,
            key: buttonKey,
            press: async () => {
                throw new Error('not used in this story')
            },
            states: async () => ({}),
            runCommand: async () => {},
            commandLabel: () => undefined,
            daemonEnabled: () => true,
            notOwner: () => false,
            isTrusted: () => false,
            trust: () => {},
        })
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const fence = (body: string) => '```button\n' + body + '\n```'

const SINGLE = [
    '# Weekly review',
    '',
    'Press to have the daemon summarise this note.',
    '',
    fence('label: Summarize\nkind: primary\nprompt: Summarize this note.'),
    '',
    'Text after the button.',
].join('\n')

const ROW = [
    '# Weekly review',
    '',
    fence(
        [
            '- label: Summarize',
            '  kind: primary',
            '  prompt: Summarize this note.',
            '- label: Ask',
            '  send: What is still open here?',
            '- label: Clear',
            '  kind: danger',
            '  prompt: Remove finished tasks from this note.',
        ].join('\n'),
    ),
    '',
    'Text after the row.',
].join('\n')

const INVALID = [
    '# Weekly review',
    '',
    fence('label: Broken\nprompt: x\nsend: y'),
    '',
    'Text after the invalid block.',
].join('\n')

const frame = (doc: string) => (
    <div style={{ height: '320px', width: 'min(760px, 100%)' }}>
        <CmHarness
            {...{ doc }}
            extensions={[notePathFacet.of('week.md'), buttonBlock()]}
        />
    </div>
)

const block = (el: HTMLElement) =>
    el.querySelector<HTMLElement>('[data-button-block]')

export const SingleButton: Story = {
    render: () => frame(SINGLE),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(block(canvasElement)).not.toBeNull())
        expect(canvasElement.textContent).toContain('summarize')
        expect(canvasElement.textContent).not.toContain('```button')
    },
}

export const Row: Story = {
    render: () => frame(ROW),
    play: async ({ canvasElement }) => {
        await waitFor(() =>
            expect(block(canvasElement)?.querySelectorAll('button').length).toBe(3),
        )
    },
}

export const InvalidFence: Story = {
    render: () => frame(INVALID),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(block(canvasElement)).not.toBeNull())
        expect(block(canvasElement)?.querySelectorAll('button').length).toBe(0)
        expect(block(canvasElement)?.textContent?.trim().length).toBeGreaterThan(0)
    },
}

/** A double-click on the row's empty space reveals the raw fence, numbered like a revealed query. */
export const RevealedSource: Story = {
    render: () => frame(ROW),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(block(canvasElement)).not.toBeNull())
        await userEvent.dblClick(block(canvasElement)!)
        await waitFor(() => expect(block(canvasElement)).toBeNull())
        expect(canvasElement.textContent).toContain('```button')
        expect(canvasElement.textContent).toContain('label: Summarize')
    },
}
