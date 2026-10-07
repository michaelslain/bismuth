// Visual spec for <ChatComposer> — the chat's draft surface: a single-purpose CodeMirror editor
// with `@file` / `[[note]]` / `#tag` mention autocomplete and its own key routing. This file does
// NOT modify the component; every story renders the real one, driven by its own props.
//
// THIS FILE EXISTS BECAUSE THE COMPOSER HAD NO STORY AT ALL, and a typeface bug lived in exactly
// that gap: the composer set the mono UI font (`--ui-font-stack`, then a separate `--editor-font`)
// while ChatTranscript renders the message it produces in `--prose-font`, so a message silently
// changed face between writing it and reading it back.
// A component with no story is invisible to visual verification, which is to say untested.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import { ChatComposer, type ComposerHandle } from './ChatComposer'
import { expectProseFace, expectFamilyReallyLoaded } from '../ui/_fontFace'
import './ChatComposer.module.css'
import ChatTextBubble from './ChatTextBubble'

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
        // Computed font-family returns the DECLARED STACK STRING, not whether the face ever
        // loaded — a stack that silently fell through to the Georgia fallback would still match
        // a family-name regex. expectProseFace follows the LIVE --prose-font token instead (so a
        // repointed token is honored rather than a literal being re-pinned), and
        // expectFamilyReallyLoaded proves the default IBM Plex Serif face actually resolved —
        // document.fonts.check cannot: it is true for a family that doesn't exist (the fallback
        // is usable) and false for a registered-but-not-yet-laid-out webface, so it stays green
        // when the face is absent and turns red the moment it is really present.
        expectProseFace(scroller as HTMLElement)
        await expectFamilyReallyLoaded('IBM Plex Serif')
        // The composer sits at --prose-font-size = --editor-font-size * --prose-scale, pinned
        // exactly. It used to assert "bigger than the mono size", which only held while every
        // prose face had a scale above 1 — IBM Plex Serif's is 1.00 (x-height parity with the
        // mono), so the two sizes now legitimately coincide. getPropertyValue on
        // --prose-font-size returns the unresolved calc() text, so multiply the two plain tokens.
        const root = getComputedStyle(document.documentElement)
        const editorPx = parseFloat(root.getPropertyValue('--editor-font-size'))
        const proseScale = parseFloat(root.getPropertyValue('--prose-scale'))
        // A fallback here would turn an unresolved token into 0 and trivialize the check into a
        // passing test. Fail loudly instead.
        await expect(Number.isFinite(editorPx) && editorPx > 0).toBe(true)
        await expect(Number.isFinite(proseScale) && proseScale > 0).toBe(true)
        await expect(parseFloat(cs.fontSize)).toBe(
            Math.round(editorPx * proseScale * 100) / 100,
        )
    },
}

/** A multi-line draft: the composer grows with its content up to its own max-height, then scrolls
 *  internally rather than pushing the transcript off screen. */
export const MultiLine: Story = {
    render: () => (
        <Composer initial={'First line of the draft.\n\nA second paragraph.\n\nAnd a third, so the box has grown well past one row.'} />
    ),
}

/** A draft containing a task line. The composer is a zero-left-padding host (`layout: 'padded'`
 *  here only adds outer page padding, not padding inside the CodeMirror scroller), which is
 *  exactly the shape `.cm-task`'s bracket-marker geometry comment warns can clip the marker's
 *  left edge — this proves it doesn't. */
export const TaskLine: Story = {
    render: () => <Composer initial={'- [ ] todo\n- [x] done'} />,
}

/** THE REFLOW A USER FEELS: the composer and the sent bubble must set the same text at the same
 *  line pitch, or the message jumps the moment Enter is pressed. The composer's line-height was a
 *  hardcoded 1.45 against the bubble's `--lh-prose` 1.6 — a visible 10% reflow. Both are rendered
 *  here with the same words; the assertion compares what the browser COMPUTED, not the two source
 *  values, so a third rule that overrides either one is caught too. */
export const MatchesTheSentBubble: Story = {
    render: () => {
        const draft = 'What is still open in my daily note?'
        return (
            <div style={{ width: '640px', 'max-width': '100%' }}>
                <Composer initial={draft} />
                <ChatTextBubble role="user" text={draft} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const line = canvasElement.querySelector('.cm-content .cm-line')
        const bubble = canvasElement.querySelector('[data-chat-bubble]')
        if (!line || !bubble)
            throw new Error('composer line and sent bubble must both mount')
        const pitch = (el: Element) => {
            const cs = getComputedStyle(el)
            return { lh: parseFloat(cs.lineHeight), fs: parseFloat(cs.fontSize) }
        }
        const composer = pitch(line)
        const sent = pitch(bubble)
        expect(composer.fs).toBeCloseTo(sent.fs, 2)
        expect(composer.lh).toBeCloseTo(sent.lh, 2)
        // And it is the prose ratio, not merely two equal wrong numbers.
        const ratio = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--lh-prose'),
        )
        expect(composer.lh / composer.fs).toBeCloseTo(ratio, 2)
    },
}
