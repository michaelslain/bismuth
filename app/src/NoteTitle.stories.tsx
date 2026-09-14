// Visual spec for <NoteTitle> — the inline `# <title>` heading at the top of a note editor.
// By default the title is a pure function of `path` (deriveTitle, noteTitleOps.ts) and IS
// editable: committing renames the file via api.move (a generic-ok POST under the shared
// fakeTransport). Two optional props change that — `title` supplies a heading the path does not
// carry, and `readOnly` makes it display-only. Both exist for daemon pages, whose subject lives
// in frontmatter and whose filename is a slug the daemon looks them up by.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { NoteTitle } from './NoteTitle'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import type { Transport } from './api'

/** Records every `POST /move { from, to }` on top of the shared fakeTransport, which acks
 *  move generically (see _fakeTransport.ts's header) and has no call log of its own. Reset per
 *  story via `moveCalls.length = 0` in `render`, read in `play`. */
const moveCalls: { from: string; to: string }[] = []
function recordingTransport(): Transport {
    const base = fakeTransport()
    return {
        ...base,
        post: async (path: string, body: unknown) => {
            if (path === '/move')
                moveCalls.push(body as { from: string; to: string })
            return base.post(path, body)
        },
    }
}

const meta = {
    title: 'App/NoteTitle',
    component: NoteTitle,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof NoteTitle>

export default meta
type Story = StoryObj<typeof meta>

/** A short, ordinary note title. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <NoteTitle path="reading/Weekly Review.md" />
        </div>
    ),
}

/** An OVERRIDDEN, display-only title — what a daemon-page heading is (InboxPageView.tsx). The
 *  path is a slug (`reply-drafts.md`) but the heading shows the page's frontmatter subject, so
 *  the inbox row and the page you land on say the same thing. `readOnly` because the daemon owns
 *  the title: the editable field renames the FILE, which would desync the slug the daemon looks
 *  pages up by. Contrast `Default`, where the same component is editable and shows the filename. */
export const OverriddenReadOnly: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <NoteTitle
                path=".daemon/pages/reply-drafts.md"
                title={() => '3 reply drafts ready'}
                readOnly
            />
        </div>
    ),
}

/** An empty/whitespace override falls BACK to the path-derived title rather than rendering a
 *  blank heading — the state a daemon page is in before its poll settles. */
export const OverrideEmptyFallsBack: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <NoteTitle path="reading/Weekly Review.md" title={() => '  '} />
        </div>
    ),
}

/** A long title — the field is a <textarea> that auto-grows to wrap it onto multiple lines
 *  rather than clipping (NoteTitle.tsx's own `autosize`). */
export const LongTitle: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <NoteTitle path="projects/Q3 roadmap review notes and follow-up action items from the planning offsite.md" />
        </div>
    ),
}

/** A no-op focus+blur (click in, click out, nothing typed) must not permanently disable the
 *  NEXT rename. `commit()`'s `done` guard (NoteTitle.tsx) exists to stop Enter's blur from
 *  double-firing the same commit, but it used to latch true on ANY blur — including this
 *  no-op one — and only reset when the derived TITLE changed. A no-op commit never dispatches a
 *  rename at all (there's nothing to move), so the title never changes and the guard is never
 *  reset by it. So a real edit typed after an idle focus/blur never sent /move: the guard was
 *  already stuck true from a commit that had nothing to do. */
export const RenameAfterNoOpFocusBlur: Story = {
    render: () => {
        moveCalls.length = 0
        setTransport(recordingTransport())
        return (
            <div style={{ width: '480px' }}>
                <NoteTitle path="notes/Old.md" />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = await canvas.findByRole('textbox')
        input.focus()
        input.blur() // no-op commit — this is what latched `done`
        input.focus()
        await userEvent.clear(input)
        await userEvent.type(input, 'New{Enter}')
        await waitFor(() =>
            expect(moveCalls).toEqual([
                { from: 'notes/Old.md', to: 'notes/New.md' },
            ]),
        )
    },
}
