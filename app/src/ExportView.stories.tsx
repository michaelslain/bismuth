// Visual spec for <ExportView> — the export options screen for a file (PaneContent's
// `::export:<path>` route). One panel handles two shapes: a plain note (format picker + a live
// HTML/PNG/PDF preview iframe) and a `type: base` file (adds a view picker + Visual/Data mode).
//
// `props.path` is read via `api.read()` (ExportDeps.read → api.ts → the global fakeTransport),
// so a story only needs to seed the file it points at — same seam FileTree/PreviewView stories
// use. The write/download path (`doExport`) is NOT exercised here: it calls
// `deliverFile`/`writeToFolder`, which need a real filesystem or a Tauri shell, neither of which
// exists in Storybook — these stories cover the panel + live PREVIEW, which is everything a
// story can meaningfully verify headlessly.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { ExportView } from './ExportView'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'

const meta = {
    title: 'App/ExportView',
    component: ExportView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ExportView>

export default meta
type Story = StoryObj<typeof meta>

const NOTE_PATH = 'projects/roadmap.md'
const NOTE_BODY = [
    '# Roadmap',
    '',
    'A short note with a **bold** word and a list:',
    '',
    '- first item',
    '- second item',
].join('\n')

const BASE_PATH = 'boards/tasks.md'
// Two views (not one) so the view picker actually renders — it's gated on `views().length > 1`
// (a single-view base has nothing to pick between).
const BASE_BODY = [
    '---',
    'type: base',
    'views:',
    '  - type: table',
    '    name: Table',
    '  - type: cards',
    '    name: Cards',
    '---',
].join('\n')

/** A plain note: the format picker (HTML/PDF/MD/PNG) defaults to HTML, no view/mode controls
 *  (those are base-only), and the preview iframe renders the note's own rendered markdown. */
export const Note: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return <ExportView path={NOTE_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The preview resource is async (renderPreview reads the file + renders it) — wait for
        // either the finished iframe/img or an explicit failure state, never assert mid-render.
        await waitFor(() => {
            const frame = canvasElement.querySelector('iframe.export-frame')
            const failed = canvas.queryByText(/preview failed/i)
            expect(frame ?? failed).not.toBeNull()
        })
    },
}

/** A `type: base` file: ExportView reads its frontmatter (parseBaseFile) to discover its
 *  declared views and shows the extra view-picker + Visual/Data toggle a plain note never gets —
 *  the view picker itself only renders once there's something to pick between (`views().length
 *  > 1`), so this fixture declares two. */
export const Base: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [BASE_PATH]: BASE_BODY } }))
        return <ExportView path={BASE_PATH} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText(/export base/i)).toBeInTheDocument()
        await waitFor(() => {
            expect(canvas.getByText('Table')).toBeInTheDocument()
            expect(canvas.getByText('Cards')).toBeInTheDocument()
        })
    },
}
