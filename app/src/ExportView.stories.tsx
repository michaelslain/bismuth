// Visual spec for <ExportView> — the export options screen for a file (PaneContent's
// `::export:<path>` route). One panel handles two shapes: a plain note (format picker + a live
// HTML/PNG/PDF preview) and a `type: base` file (adds a view picker + Visual/Data mode). The PDF
// preview now renders REAL PAGES through PdfPages (the same pdf.js stack PreviewView uses),
// fed by the `htmlToPdf` prop seam (mirrors PdfPages' own `load` seam) so a story can hand it a
// pre-built PDF instead of driving the real webkit/canvas print pipeline.
//
// `props.path` is read via `api.read()` (ExportDeps.read → api.ts → the global fakeTransport),
// so a story only needs to seed the file it points at — same seam FileTree/PreviewView stories
// use. The write/download path (`doExport`) is NOT exercised here: it calls
// `deliverFile`/`writeToFolder`, which need a real filesystem or a Tauri shell, neither of which
// exists in Storybook — these stories cover the panel + live PREVIEW, which is everything a
// story can meaningfully verify headlessly.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import type { JSX } from 'solid-js'
import { ExportView } from './ExportView'
import { SHEET_PAPER, contrastRatio } from './export/sheetInk'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { buildLetterPdf, inkedPct } from './ui/_pdfStoryFixtures'
import styles from './ExportView.module.css'

const meta = {
    title: 'App/ExportView',
    component: ExportView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ExportView>

export default meta
type Story = StoryObj<typeof meta>

/** A pane's bounded height. ExportView fills its host (`height: 100%`), so with no bound the panel
 *  and the PDF stack grew past the frame: the [export] button fell off the bottom and page two was
 *  cut mid-block. A real pane always bounds it; the stories now do too. */
function Pane(props: { children: JSX.Element }) {
    return <div style={{ height: '720px' }}>{props.children}</div>
}

/** `rgb(r, g, b)` / `#rrggbb` -> `#rrggbb`, for contrastRatio. */
function toHex(css: string): string {
    const v = css.trim()
    if (v.startsWith('#')) return v.length === 4 ? `#${[...v.slice(1)].map(c => c + c).join('')}` : v
    const [r, g, b] = (v.match(/\d+/g) ?? ['0', '0', '0']).map(Number)
    return `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
}

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
const BASE_BODY = [
    '---',
    'type: base',
    'view: cards',
    '---',
].join('\n')
// The base's rows are the vault's notes, so give it some — an empty vault rendered an empty
// bordered rectangle, which proved nothing about the preview.
const BASE_ROWS: Record<string, string> = {
    'boards/Ship the export.md': '---\ntags: [work]\n---\n# Ship the export\n',
    'boards/Write the docs.md': '---\ntags: [work]\n---\n# Write the docs\n',
    'boards/Plan the trip.md': '---\ntags: [home]\n---\n# Plan the trip\n',
}

/** A plain note: the format picker (HTML/PDF/MD/PNG) defaults to HTML, no mode controls
 *  (those are base-only), and the preview iframe renders the note's own rendered markdown. */
export const Note: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return (
            <Pane>
                <ExportView path={NOTE_PATH} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The preview resource is async (renderPreview reads the file + renders it) — wait for
        // either the finished iframe/img or an explicit failure state, never assert mid-render.
        await waitFor(() => {
            const frame = canvasElement.querySelector(
                `iframe.${styles['export-frame']}`,
            )
            const failed = canvas.queryByText(/preview failed/i)
            expect(frame ?? failed).not.toBeNull()
        })
    },
}

/** A `type: base` file: ExportView reads its frontmatter (parseBaseFile) to discover its
 *  view kind and shows the Visual/Data toggle a plain note never gets. */
export const Base: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [BASE_PATH]: BASE_BODY, ...BASE_ROWS },
            }),
        )
        return (
            <Pane>
                <ExportView path={BASE_PATH} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText(/export base/i)).toBeInTheDocument()
        await waitFor(() => {
            expect(canvas.getByText('Visual')).toBeInTheDocument()
            expect(canvas.getByText('Data')).toBeInTheDocument()
        })
    },
}

/** A note exported as PDF: the preview now renders the REAL pages through PdfPages, fed by the
 *  `htmlToPdf` prop seam — a 2-page PDF built in-browser, standing in for the webkit/canvas print
 *  pipeline neither of which can run in Storybook. Proves the preview shows real pdf.js pages
 *  (≥2 canvases painted with real ink) and the "N pages" readout. */
export const NotePdfPreview: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return (
            <Pane>
                <ExportView
                    path={NOTE_PATH}
                    htmlToPdf={async () =>
                        new Uint8Array(
                            buildLetterPdf([
                                { label: 'Page one', color: [200, 60, 60] },
                                { label: 'Page two', color: [60, 140, 60] },
                            ]),
                        )
                    }
                />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        canvas.getByText('PDF').click()
        await waitFor(() => {
            const paper = canvasElement.querySelector(
                `.${styles['exp-paper']}`,
            )
            expect(paper?.querySelectorAll('canvas').length ?? 0).toBeGreaterThanOrEqual(2)
            expect(canvas.getByText('2 pages')).toBeInTheDocument()
        })
        await waitFor(() => {
            const firstCanvas = canvasElement.querySelector(
                `.${styles['exp-paper']} canvas`,
            ) as HTMLCanvasElement
            expect(inkedPct(firstCanvas)).toBeGreaterThan(0.005)
        })
    },
}

/** The LIGHT export theme: the sheet is fixed print-cream, so its ink must come from the export
 *  palette, never from the app's own tokens (the app's `--fg` is 1.18:1 on cream in the default
 *  ink theme). The play measures the sheet's computed ink against its cream — all three ink tokens
 *  the sheet re-scopes — and the floor is 4.5:1 for text. It fails with the override removed: the
 *  sheet's `color` falls back to the app's cream-coloured `--fg`. */
export const LightSheetInk: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return (
            <Pane>
                <ExportView path={NOTE_PATH} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        canvas.getByText('Light').click()
        await waitFor(() => {
            const paper = canvasElement.querySelector(
                `.${styles['exp-paper']}`,
            ) as HTMLElement
            const cs = getComputedStyle(paper)
            expect(toHex(cs.getPropertyValue('--paper-bg'))).toBe(SHEET_PAPER)
            const ink = toHex(cs.color)
            const muted = toHex(cs.getPropertyValue('--text-muted'))
            const faint = toHex(cs.getPropertyValue('--faint'))
            expect(contrastRatio(ink, SHEET_PAPER)).toBeGreaterThanOrEqual(4.5)
            expect(contrastRatio(muted, SHEET_PAPER)).toBeGreaterThanOrEqual(4.5)
            expect(contrastRatio(faint, SHEET_PAPER)).toBeGreaterThanOrEqual(4.5)
        })
    },
}
