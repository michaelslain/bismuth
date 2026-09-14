// Visual spec for <CompanionFrontmatter> — the tag-carrying companion note's frontmatter strip,
// mounted under PreviewView's ViewBar for image/pdf kinds (see PreviewView.stories.tsx's Image
// and Pdf stories for that mount-point wiring). Exercised directly here, over a fake `api.read`/
// `api.writeChecked` transport, so these stories prove the strip's OWN load/edit/write behaviour
// without depending on an image or PDF actually rendering.
//
// SIMULATING A KEYSTROKE: MarkdownField is a CodeMirror 6 field (a contenteditable div, not an
// <input>), so `fireEvent.input` can't drive it the way it drives the plain <input> find bar in
// PreviewView.stories.tsx. Editor.stories.tsx's own pattern is the one to copy: resolve the LIVE
// EditorView off the mounted `.cm-editor` DOM node via `EditorView.findFromDOM`, then
// `view.dispatch({ changes: {...} })` directly — that's a real doc edit through CodeMirror's own
// transaction system, which fires MarkdownField's `updateListener` (`u.docChanged` -> `onInput`)
// exactly as a keystroke would.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import CompanionFrontmatter from './CompanionFrontmatter'
import { companionPathFor } from '../../../core/src/fileKinds'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { settings } from '../settings'

const meta = {
    title: 'Preview/CompanionFrontmatter',
    component: CompanionFrontmatter,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CompanionFrontmatter>

export default meta
type Story = StoryObj<typeof meta>

const NO_TAGS = () => [] as string[]

/** The live CM6 EditorView mounted inside the strip, or throws — same helper Editor.stories.tsx
 *  uses to drive a real doc edit instead of trying to synthesize contenteditable DOM events. */
function liveView(canvasElement: HTMLElement): EditorView {
    const dom = canvasElement.querySelector('.cm-editor')
    const v = dom && EditorView.findFromDOM(dom as HTMLElement)
    if (!v) throw new Error('could not find EditorView')
    return v
}

/** No companion note exists yet for this binary. */
export const NoCompanion: Story = {
    render: () => {
        setTransport(fakeTransport({ files: {} }))
        return (
            <CompanionFrontmatter binaryPath="photo.png" tagNames={NO_TAGS} />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // Lazy creation (plan "Design"): a fresh binary shows the EMPTY_FRONTMATTER template —
        // 'tags: []' — not a blank field.
        await waitFor(() =>
            expect(canvas.getByText(/tags/)).toBeInTheDocument(),
        )
        // No write happened just from rendering the strip and leaving it alone — the companion
        // must not spring into existence merely because an image was opened. Waited past the
        // debounce (settings.editor.autoSaveDelay) so this can't pass on a write still in flight.
        await new Promise(r =>
            setTimeout(r, settings.editor.autoSaveDelay + 200),
        )
        await expect(await api.read(companionPathFor('photo.png'))).toBe('')
    },
}

const EXISTING_PATH = 'photo.png.md'
const EXISTING_TEXT = '---\ntags: [trip, 2026]\n---\nA note about the trip.\n'

/** An existing companion with tags AND a hand-written body — both tags render, and typing a new
 *  one writes a companion whose text still carries the body untouched. */
export const ExistingCompanionWithBody: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { [EXISTING_PATH]: EXISTING_TEXT } }),
        )
        return (
            <CompanionFrontmatter binaryPath="photo.png" tagNames={NO_TAGS} />
        )
    },
    play: async ({ canvasElement }) => {
        // Both existing tags render.
        await waitFor(() => {
            expect(canvasElement.textContent).toContain('trip')
            expect(canvasElement.textContent).toContain('2026')
        })

        // Type a third tag by editing the live CM doc directly (see the file header) — insert
        // right before the closing `]` of the tags array.
        const view = liveView(canvasElement)
        const doc = view.state.doc.toString()
        const insertAt = doc.indexOf(']')
        await expect(insertAt).toBeGreaterThan(-1)
        view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: ', summer' },
        })
        await waitFor(() =>
            expect(canvasElement.textContent).toContain('summer'),
        )

        // Past the debounce, the write landed AND the hand-written body is still there —
        // companionDoc.ts's joinCompanion never touches the body half.
        await waitFor(
            async () => {
                const written = await api.read(EXISTING_PATH)
                expect(written).toContain('summer')
                expect(written).toContain('A note about the trip.')
            },
            { timeout: settings.editor.autoSaveDelay + 2000 },
        )
    },
}

/** Switching to a different binary drops the old companion's text immediately — no stale tags
 *  bleeding across a tab switch (the task's "reacts to binaryPath changes" requirement). */
export const SwitchesBinaryPath: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    'a.png.md': '---\ntags: [alpha]\n---\n',
                    'b.png.md': '---\ntags: [beta]\n---\n',
                },
            }),
        )
        const [path, setPath] = createSignal('a.png')
        return (
            <div>
                <button
                    type="button"
                    data-testid="switch-to-b"
                    onClick={() => setPath('b.png')}
                >
                    switch to b.png
                </button>
                <CompanionFrontmatter binaryPath={path()} tagNames={NO_TAGS} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvasElement.textContent).toContain('alpha'),
        )
        await expect(canvasElement.textContent).not.toContain('beta')

        await fireEvent.click(canvas.getByTestId('switch-to-b'))

        // The OLD binary's tag is gone as soon as the new companion loads — never a stale frame
        // showing "alpha" (or a stale "beta" if this ran the other way) while the switch settles.
        await waitFor(() => expect(canvasElement.textContent).toContain('beta'))
        await expect(canvasElement.textContent).not.toContain('alpha')
    },
}
