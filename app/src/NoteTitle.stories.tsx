// Visual spec for <NoteTitle> — the inline `# <title>` heading at the top of a note editor.
// By default the title is a pure function of `path` (deriveTitle, noteTitleOps.ts) and IS
// editable: committing renames the file via api.move (a generic-ok POST under the shared
// fakeTransport). Two optional props change that — `title` supplies a heading the path does not
// carry, and `readOnly` makes it display-only. Both exist for daemon pages, whose subject lives
// in frontmatter and whose filename is a slug the daemon looks them up by.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { NoteTitle } from './NoteTitle'

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
