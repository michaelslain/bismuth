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
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CardEditor } from './CardEditor'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'
import { api } from '../api'

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
    // Proves the tasks-mode checklist theme (Task 4: bracket marker instead of livePreview's
    // drawn checkbox) doesn't break the checkbox widget's own interaction: left-click still
    // toggles done<->todo AND autosaves the note, right-click still opens the shared status
    // menu (taskStatusMenu.tsx). Every SAMPLE_ROWS body carries the same fixed checklist
    // ("- [ ] first checklist item\n- [x] second, already done"), so the first checkbox starts
    // 'todo'.
    play: async ({ canvasElement }) => {
        const path = SAMPLE_ROWS[3].file.path
        const box = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                '.cm-task-checkbox',
            )
            if (!el) throw new Error('checkbox not mounted yet')
            return el
        })
        expect(box.getAttribute('data-status')).toBe('todo')

        // Left-click toggles the in-buffer status immediately...
        await userEvent.click(box)
        await waitFor(() => expect(box.getAttribute('data-status')).toBe('done'))
        // ...and the debounced autosave actually persists it to disk (api.write, not just the
        // CodeMirror buffer) — the proof this is a real edit, not a display-only glyph swap.
        await waitFor(
            async () =>
                expect(await api.read(path)).toContain('- [x] first checklist item'),
            { timeout: 3000 },
        )

        // Right-click still opens the shared status menu (portals to document.body), with the
        // now-current status ("Done") filtered out of the offered options.
        box.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 20,
                clientY: 20,
            }),
        )
        const body = within(document.body)
        const inProgress = await waitFor(() => body.getByText('In progress'))
        expect(body.queryByText('Done')).not.toBeInTheDocument()

        // Picking a status from the menu still writes the chosen char through.
        inProgress.click()
        await waitFor(() => expect(box.getAttribute('data-status')).toBe('doing'))
        await waitFor(
            async () =>
                expect(await api.read(path)).toContain('- [/] first checklist item'),
            { timeout: 3000 },
        )
    },
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
