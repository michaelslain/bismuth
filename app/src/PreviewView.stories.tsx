// Visual spec for <PreviewView> — the read-only preview tab for non-note files (images, PDFs,
// code/text, and unrenderable binaries), routed from PaneContent by `previewKind()`.
//
// FIXTURE SEAM: `code` kind fetches its body via `api.read(path)` (GET /file), so a `Code`
// story must layer `setTransport(fakeTransport({ files: {...} }))` (app/src/ui/_fakeTransport.ts)
// on top of the Storybook-wide transport, same pattern as FileTree.stories.tsx — each story
// below sets its own so none depends on another story having run first in the session.
//
// IMAGE / PDF ARE HONEST FAILURES HERE, NOT A GAP: `assetUrl()` builds `${apiBase()}/asset?path=…`,
// and the fake transport's `base()` returns `"fake://storybook"` — an <img>/<iframe> pointing at
// that URL genuinely cannot load, exactly like a moved/unresolved asset in the real app. The
// `Image` story below exercises PreviewView's OWN handling of that (`onError` -> `imgFailed` ->
// the "Couldn't load image" EmptyState), which is real component behaviour, not a story that
// merely proves an <img> tag exists. `Pdf` renders the iframe shell (browsers don't fire a
// visible error for a bad iframe src the way <img> does, so there's nothing further to assert
// there beyond "the embed mounts").
//
// `isTauri()` is false in a Storybook browser tab, so "OPEN IN DEFAULT APP" / "REVEAL" never
// render here — an accurate state (the web build has no Tauri shell either), not a gap to patch.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { PreviewView } from './PreviewView'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { annotatePath } from './tabIds'
import styles from './PreviewView.module.css'

const meta = {
    title: 'App/PreviewView',
    component: PreviewView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PreviewView>

export default meta
type Story = StoryObj<typeof meta>

const CODE_PATH = 'src/example.ts'
const CODE_CONTENT = `export function greet(name: string): string {
    // return a friendly, capitalized greeting
    return \`Hello, \${name}!\`
}

export function farewell(name: string): string {
    return \`Goodbye, \${name}.\`
}
`

/** Counts \`onOpen\` calls — reset per story, read in that story's \`play\`. Module-level rather
 *  than a Storybook \`fn()\` mock, matching FileTree.stories.tsx's \`dragStarts\` pattern. */
let opened: string[] = []
const onOpen = (path: string) => opened.push(path)

/** A code/text file, found via extension (\`.ts\` -> CODE_EXT). Shows the read-only monospace
 *  body with no find bar open (PreviewView's rest state). */
export const Code: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} onOpen={onOpen} />
    },
}

/** Interactive: Cmd/Ctrl+F opens the real find bar (settings.keybindings.find defaults to
 *  "Mod+F"), typing "return" highlights both real occurrences, and Next/Previous step the
 *  active match — driving the actual find pipeline (findMatches/segmentText), not a canned
 *  highlighted render. */
export const CodeFind: Story = {
    render: () => {
        opened = []
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} onOpen={onOpen} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const root = canvasElement.querySelector(
            `.${styles['preview-app']}`,
        ) as HTMLElement
        // Wait for the code body to load before opening find, matching how a user would.
        await canvas.findByText(/export function greet/)
        fireEvent.keyDown(root, { key: 'f', ctrlKey: true })

        const input = await canvas.findByPlaceholderText('Find')
        await fireEvent.input(input, { target: { value: 'return' } })

        await waitFor(() => expect(canvas.getByText('1/2')).toBeInTheDocument())
        const marks = canvasElement.querySelectorAll(
            `.${styles['preview-find-match']}`,
        )
        await expect(marks.length).toBe(2)
        await expect(marks[0]).toHaveClass(styles['is-active'])

        await fireEvent.click(canvas.getByLabelText('Next match (Enter)'))
        await waitFor(() => expect(canvas.getByText('2/2')).toBeInTheDocument())
        await expect(marks[1]).toHaveClass(styles['is-active'])
    },
}

/** A search with no hits — the "No results" count label instead of an N/M count, and the
 *  Previous/Next steppers disabled since there is nothing to step through. */
export const CodeFindNoResults: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} onOpen={onOpen} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const root = canvasElement.querySelector(
            `.${styles['preview-app']}`,
        ) as HTMLElement
        await canvas.findByText(/export function greet/)
        fireEvent.keyDown(root, { key: 'f', ctrlKey: true })
        const input = await canvas.findByPlaceholderText('Find')
        await fireEvent.input(input, { target: { value: 'zzz-nomatch' } })
        await waitFor(() =>
            expect(canvas.getByText('No results')).toBeInTheDocument(),
        )
        await expect(canvas.getByLabelText('Next match (Enter)')).toBeDisabled()
    },
}

/** An image path (`.png`) — see the file-level note: this genuinely fails to load against the
 *  fake transport's `fake://storybook` base, so PreviewView's own `onError` -> "Couldn't load
 *  image" EmptyState is what renders, not a canned broken-image story. */
export const Image: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="assets/diagram.png" onOpen={onOpen} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByText("Couldn't load image")).toBeInTheDocument(),
        )
    },
}

/** A PDF path — the embedded-viewer iframe shell (FitH), plus the ANNOTATE affordance since
 *  PDFs are annotatable. */
export const Pdf: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="docs/handbook.pdf" onOpen={onOpen} />
    },
}

/** An unrenderable binary (`.psd`) — the "Preview not available" EmptyState naming the
 *  extension, no ANNOTATE affordance since only image/pdf are annotatable. */
export const External: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="design/mockup.psd" onOpen={onOpen} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/This \.PSD file/)).toBeInTheDocument()
        await expect(canvas.queryByText('ANNOTATE')).not.toBeInTheDocument()
    },
}

/** Clicking ANNOTATE on an image hands off to the `.draw` markup surface via `onOpen`,
 *  exercising the real callback wiring rather than just asserting the button exists. */
export const AnnotateHandsOffToMarkup: Story = {
    render: () => {
        opened = []
        setTransport(fakeTransport({}))
        return <PreviewView path="assets/diagram.png" onOpen={onOpen} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await fireEvent.click(await canvas.findByText('ANNOTATE'))
        await waitFor(() =>
            expect(opened).toEqual([annotatePath('assets/diagram.png')]),
        )
    },
}
