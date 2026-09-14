// Visual spec for <PreviewView> — the read-only preview tab for non-note files (images, PDFs,
// code/text, and unrenderable binaries), routed from PaneContent by `previewKind()`.
//
// FIXTURE SEAM: `code` kind fetches its body via `api.read(path)` (GET /file), so a `Code`
// story must layer `setTransport(fakeTransport({ files: {...} }))` (app/src/ui/_fakeTransport.ts)
// on top of the Storybook-wide transport, same pattern as FileTree.stories.tsx — each story
// below sets its own so none depends on another story having run first in the session.
//
// IMAGE / PDF ARE HONEST FAILURES HERE, NOT A GAP: `assetUrl()` builds `${apiBase()}/asset?path=…`,
// and the fake transport's `base()` returns `"fake://storybook"` — an <img src> or a `fetch()`
// pointed at that URL genuinely cannot load, exactly like a moved/unresolved asset in the real
// app. The `Image` story below exercises PreviewView's OWN handling of that (`onError` ->
// `imgFailed` -> the "Couldn't load image" EmptyState); `Pdf` exercises PdfPages' equivalent —
// its `load()` seam calls `fetch(assetUrl())`, which rejects against the unfetchable
// `fake://storybook` scheme, so PdfPages' own "Couldn't load PDF" EmptyState is what renders.
// Real PDF rendering (real pages, real ink) is covered by Preview/PdfPages.stories.tsx, which
// feeds PdfPages a real in-browser-generated PDF through the same `load()` seam instead.
//
// `isTauri()` is false in a Storybook browser tab, so "OPEN IN DEFAULT APP" / "REVEAL" never
// render here — an accurate state (the web build has no Tauri shell either), not a gap to patch.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { PreviewView } from './PreviewView'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import styles from './PreviewView.module.css'

const meta = {
    title: 'App/PreviewView',
    component: PreviewView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PreviewView>

export default meta
type Story = StoryObj<typeof meta>

// PreviewView's `tagNames` (companion-note tag autocomplete, not exercised by any story here —
// see Preview/CompanionFrontmatter.stories.tsx) — a fixed empty candidate list is enough to
// satisfy the prop.
const NO_TAGS = () => [] as string[]

const CODE_PATH = 'src/example.ts'
const CODE_CONTENT = `export function greet(name: string): string {
    // return a friendly, capitalized greeting
    return \`Hello, \${name}!\`
}

export function farewell(name: string): string {
    return \`Goodbye, \${name}.\`
}
`

/** A code/text file, found via extension (\`.ts\` -> CODE_EXT). Shows the read-only monospace
 *  body with no find bar open (PreviewView's rest state). */
export const Code: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
    },
}

/** Interactive: Cmd/Ctrl+F opens the real find bar (settings.keybindings.find defaults to
 *  "Mod+F"), typing "return" highlights all THREE occurrences, and Next/Previous step the
 *  active match — driving the actual find pipeline (findMatches/segmentText), not a canned
 *  highlighted render.
 *
 *  THREE, NOT TWO, AND THE FIRST ONE IS INSIDE A COMMENT. This story asserted `1/2` for a while,
 *  on the reading that the `// return a friendly, capitalized greeting` line was not a "real"
 *  occurrence. There is no such distinction to make: `preview/findMatches.ts` is a literal
 *  `hay.indexOf(needle)` substring scan over the raw file text, with no lexer and no notion of a
 *  comment — the same contract as the browser's own Cmd+F, which is the whole point of a find bar
 *  over a read-only code preview. Counting 3 is the component being correct, so the expectation
 *  moved rather than the implementation, and the comment hit is asserted BY POSITION below so a
 *  future change that starts skipping comments fails here instead of quietly editing 3 back to 2. */
export const CodeFind: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
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

        await waitFor(() => expect(canvas.getByText('1/3')).toBeInTheDocument())
        const marks = canvasElement.querySelectorAll(
            `.${styles['preview-find-match']}`,
        )
        await expect(marks.length).toBe(3)
        await expect(marks[0]).toHaveClass(styles['is-active'])
        // Match #1 is the one in the `// return a friendly…` comment — the text run immediately
        // before it ends in the comment opener. Pinned here so "find stops matching in comments"
        // can only ever show up as a failure, never as a quietly-decremented count.
        await expect(marks[0]?.previousSibling?.textContent).toContain('//')

        await fireEvent.click(canvas.getByLabelText('Next match (Enter)'))
        await waitFor(() => expect(canvas.getByText('2/3')).toBeInTheDocument())
        await expect(marks[1]).toHaveClass(styles['is-active'])
    },
}

/** A search with no hits — the "No results" count label instead of an N/M count, and the
 *  Previous/Next steppers disabled since there is nothing to step through. */
export const CodeFindNoResults: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
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
        return <PreviewView path="assets/diagram.png" tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByText("Couldn't load image")).toBeInTheDocument(),
        )
        // The ANNOTATE hand-off is retired: ink is drawn in place, so no button for it.
        await expect(canvas.queryByText('ANNOTATE')).not.toBeInTheDocument()
        // Companion tags strip (Task 2): image is an "inkable" kind, so the frontmatter strip
        // mounts under the ViewBar independently of whether the PICTURE itself loaded — a fresh
        // companion shows the EMPTY_FRONTMATTER template. See Preview/CompanionFrontmatter for
        // the strip's own dedicated coverage (load/edit/write).
        await waitFor(() => {
            const strip = canvasElement.querySelector(
                '[data-companion-frontmatter]',
            )
            expect(strip?.textContent).toContain('tags')
        })
    },
}

/** A PDF path — the ViewBar zoom controls plus PdfPages' own load failure (see the header). No
 *  ANNOTATE button: ink on a PDF is drawn in place with the toggle-draw-mode key. */
export const Pdf: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="docs/handbook.pdf" tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The ViewBar zoom controls (config region) only render for the pdf kind; the retired
        // ANNOTATE hand-off is gone.
        await expect(canvas.queryByText('ANNOTATE')).not.toBeInTheDocument()
        await expect(canvas.getByLabelText('Zoom in')).toBeInTheDocument()
        await expect(canvas.getByLabelText('Zoom out')).toBeInTheDocument()
        await expect(canvas.getByText('FIT')).toBeInTheDocument()
        // PdfPages' own load() seam (fetch(assetUrl())) genuinely fails against the fake
        // transport's unfetchable base — see the file header — so its "Couldn't load PDF"
        // EmptyState is what should render here, not a blank pane.
        await waitFor(() =>
            expect(canvas.getByText("Couldn't load PDF")).toBeInTheDocument(),
        )
        // Companion tags strip (Task 2): pdf is the other "inkable" kind — mounts under the
        // ViewBar the same as Image, independent of PdfPages' own load failure.
        await waitFor(() => {
            const strip = canvasElement.querySelector(
                '[data-companion-frontmatter]',
            )
            expect(strip?.textContent).toContain('tags')
        })
    },
}

/** An unrenderable binary (`.psd`) — the "Preview not available" EmptyState naming the
 *  extension. */
export const External: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PreviewView path="design/mockup.psd" tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/This \.PSD file/)).toBeInTheDocument()
        await expect(canvas.queryByText('ANNOTATE')).not.toBeInTheDocument()
        // `.psd` is `external`, not `inkable` — no companion tags strip for it (unrenderable
        // binaries other than images/PDFs are out of scope for Task 2 per the plan's rulings).
        await expect(
            canvasElement.querySelector('[data-companion-frontmatter]'),
        ).not.toBeInTheDocument()
    },
}

/** The toggle-draw-mode keybinding on a PDF/image preview, as a real keydown on the preview root.
 *  PreviewView catches it in the CAPTURE phase and CONSUMES it for the ink kinds — that is what
 *  keeps the key from reaching App.tsx's window handler and the browser. A code preview has no
 *  ink, so the same key must pass through untouched. (The ink layer itself cannot mount here:
 *  the page never loads against the fake transport. Preview/PageInk proves the drawing.)
 *  Never a hardcoded combo in the component — the settings store is the source of truth; this
 *  story sends the default `Mod+Shift+I` the way Editor.stories.tsx does. */
const toggleDrawKey = (target: HTMLElement): boolean =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'I',
            code: 'KeyI',
            metaKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        }),
    )

export const DrawModeKeyOnlyOnInkKinds: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_CONTENT } }))
        return (
            <div style={{ display: 'flex', height: '100%' }}>
                <div style={{ flex: '1' }} data-testid="pdf-preview">
                    <PreviewView path="docs/handbook.pdf" tagNames={NO_TAGS} />
                </div>
                <div style={{ flex: '1' }} data-testid="code-preview">
                    <PreviewView path={CODE_PATH} tagNames={NO_TAGS} />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const rootIn = (id: string) =>
            canvasElement.querySelector(
                `[data-testid="${id}"] .${styles['preview-app']}`,
            ) as HTMLElement
        await waitFor(() => expect(rootIn('pdf-preview')).not.toBeNull())
        await waitFor(() => expect(rootIn('code-preview')).not.toBeNull())
        // dispatchEvent returns FALSE when a listener called preventDefault.
        await expect(toggleDrawKey(rootIn('pdf-preview'))).toBe(false)
        await expect(toggleDrawKey(rootIn('code-preview'))).toBe(true)
    },
}
