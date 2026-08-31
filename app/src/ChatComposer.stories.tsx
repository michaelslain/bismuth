// Visual spec for <ChatComposer> — the chat's draft surface: a single-purpose CodeMirror editor
// with `@file` / `[[note]]` / `#tag` mention autocomplete and its own key routing. This file does
// NOT modify the component; every story renders the real one, driven by its own props.
//
// THIS FILE EXISTS BECAUSE THE COMPOSER HAD NO STORY AT ALL, and a typeface bug lived in exactly
// that gap: the composer set `--editor-font` while ChatTranscript renders the message it produces
// in `--prose-font`, so a message silently changed face between writing it and reading it back.
// A component with no story is invisible to visual verification, which is to say untested.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import { ChatComposer, type ComposerHandle } from './ChatComposer'
import './ChatComposer.module.css'

const meta = {
    title: 'Chat/ChatComposer',
    component: ChatComposer,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatComposer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const none = () => []

/** Every prop the composer needs, with the mention sources empty — the stories below are about the
 *  surface itself, not the autocomplete (which needs a vault to be interesting). */
function Composer(props: { initial?: string; placeholder?: string }) {
    const [text, setText] = createSignal(props.initial ?? '')
    return (
        <div style={{ width: '640px', 'max-width': '100%' }}>
            <ChatComposer
                value={text}
                onInput={setText}
                placeholder={() => props.placeholder ?? 'Message Claude'}
                getNotes={none}
                getMemories={none}
                getTags={none}
                getFiles={none}
                onFileMention={noop}
                onPaste={noop}
                onKeyDown={() => false}
                onReady={(_: ComposerHandle) => {}}
            />
        </div>
    )
}

/** Empty, showing the placeholder — the resting state of a new chat. */
export const Empty: Story = { render: () => <Composer /> }

/** A draft mid-write. THE ASSERTION IS THE POINT: the composer must be set in the same
 *  proportional face, at the same optically-compensated size, that ChatTranscript renders the sent
 *  message in. It was `--editor-font` at `--editor-font-size`, so the text visibly reflowed and
 *  changed typeface the moment you pressed Enter. */
export const Drafting: Story = {
    render: () => (
        <Composer initial="What's still open in my daily note? I want the ones I actually said I'd finish." />
    ),
    play: async ({ canvasElement }) => {
        const scroller = canvasElement.querySelector('.cm-scroller')
        if (!scroller) throw new Error('composer did not mount a CodeMirror scroller')
        const cs = getComputedStyle(scroller)
        await expect(cs.fontFamily).toMatch(/CMU Serif/)
        // --prose-font-size is --editor-font-size * --prose-scale, so it must exceed the mono size
        // rather than merely differ from it — a bare inequality would pass on a wrong-way change.
        const root = getComputedStyle(document.documentElement)
        const mono = parseFloat(root.getPropertyValue('--editor-font-size')) || 0
        await expect(parseFloat(cs.fontSize)).toBeGreaterThan(mono)
    },
}

/** A multi-line draft: the composer grows with its content up to its own max-height, then scrolls
 *  internally rather than pushing the transcript off screen. */
export const MultiLine: Story = {
    render: () => (
        <Composer initial={'First line of the draft.\n\nA second paragraph.\n\nAnd a third, so the box has grown well past one row.'} />
    ),
}
