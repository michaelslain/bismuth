// Visual spec for <CardEditor> — the seamless, always-live CodeMirror surface a Bases card
// embeds for its note body (used by BodyCard; see BodyCard.stories.tsx for the one level up
// with its title chip). Loads content via `api.read()` on mount.
//
// `.storybook/preview.ts` installs an in-memory `fakeTransport` seeded from SAMPLE_ROWS, so
// every SAMPLE_ROWS path reads real body text (including a checklist: "- [ ] first checklist
// item\n- [x] second, already done"). Without that transport the editor sits in "Loading…"
// forever — see the component's own comment: staying loading on a read failure is deliberate
// (an empty editor whose autosave fired would overwrite the note's frontmatter), so a story
// that only shows a spinner would be verifying that failure mode, not the editor.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { CardEditor } from './CardEditor'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/CardEditor',
    component: CardEditor,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardEditor>

export default meta
type Story = StoryObj<typeof meta>

function Frame(props: { children: unknown }) {
    return (
        <div
            style={{
                width: '280px',
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                'border-radius': '10px',
                padding: '10px 12px',
            }}
        >
            {props.children as never}
        </div>
    )
}

/** Body mode: the note's full body (minus frontmatter + duplicate title) is editable. */
export const BodyMode: Story = {
    render: () => (
        <Frame>
            <CardEditor
                path={SAMPLE_ROWS[0].file.path}
                title={SAMPLE_ROWS[0].file.name}
                mode="body"
            />
        </Frame>
    ),
}

/** Tasks mode: the editable region narrows to the note's checklist lines only — prose before
 *  the first task line and anything after the last joins the (invisible) prefix/suffix that
 *  gets stitched back in on save. Every SAMPLE_ROWS body carries the same fixed checklist, so
 *  this exercises the real `splitCard` task-region narrowing, not a hand-picked fixture. */
export const TasksMode: Story = {
    render: () => (
        <Frame>
            <CardEditor
                path={SAMPLE_ROWS[3].file.path}
                title={SAMPLE_ROWS[3].file.name}
                mode="tasks"
            />
        </Frame>
    ),
}

/** A path the fake transport has no file for: `getText` (ui/_fakeTransport.ts) returns `''`
 *  rather than throwing on a missing path, so this is a genuine reachable state — a brand-new
 *  note with an empty body — not a failure. The card still mounts a live, typable editor over
 *  an empty document (no title-dedup line to strip, no checklist to narrow to). */
export const EmptyNote: Story = {
    render: () => (
        <Frame>
            <CardEditor
                path="projects/Untitled.md"
                title="Untitled"
                mode="body"
            />
        </Frame>
    ),
}
