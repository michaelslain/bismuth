// Visual spec for <ExportView> — the export pane for a file (PaneContent's `::export:<path>` route):
// a ViewBar (crumb // source // format toggle, page readout, export) over a desk holding the
// preview and a rail holding the options, grouped in the order a person decides: how it looks,
// what goes in, where it goes. The rail ends on the line naming exactly what the export writes,
// beside the button that writes it.
//
// `props.path` is read via `api.read()` and a base's rows via `api.resolveRows()` (ExportDeps →
// api.ts → the fake transport), so a story seeds the file it points at and, for a folder-sourced
// base, the rows that source resolves to — the fake transport answers `/rows` from `seed.rows`
// only, never from the seeded files. A PDF preview goes through the `htmlToPdf` prop seam (mirrors
// PdfPages' own `load` seam), so a story hands it a pre-built PDF instead of the webkit/canvas
// print pipeline. The write/download path (`doExport`) is not exercised: it needs a real
// filesystem or a Tauri shell.
//
// The pane remembers its options in localStorage (export/exportPrefs.ts), so every story starts
// from `fresh()`, which clears them and seeds the state the story is about.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import type { JSX } from 'solid-js'
import { ExportView } from './ExportView'
import PaneSuspense from './PaneSuspense'
import { SHEET_PAPER, contrastRatio } from './export/sheetInk'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { SAMPLE_ROWS } from './ui/_baseFixtures'
import { buildLetterPdf, inkedPct } from './ui/_pdfStoryFixtures'
import type { ExportFormat, ExportTheme } from './export/types'

const meta = {
    title: 'App/ExportView',
    component: ExportView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ExportView>

export default meta
type Story = StoryObj<typeof meta>

/** A pane's bounded height. ExportView fills its host (`height: 100%`); a real pane always bounds
 *  it, and without a bound the rail and the PDF stack grow past the frame. */
function Pane(props: { children: JSX.Element }) {
    return <div style={{ height: '760px' }}>{props.children}</div>
}

/** Clear every remembered export option, then seed this story's own. */
function fresh(
    prefs: { format?: ExportFormat; theme?: ExportTheme } = {},
    tab?: { path: string; mode?: 'visual' | 'data'; calStart?: string },
) {
    for (const k of Object.keys(localStorage))
        if (k.startsWith('bismuth.export.')) localStorage.removeItem(k)
    localStorage.setItem(
        'bismuth.export.prefs',
        JSON.stringify({ theme: 'dark', ...prefs }),
    )
    if (tab)
        localStorage.setItem(
            `bismuth.export.tab:${tab.path}`,
            JSON.stringify({ mode: tab.mode, calStart: tab.calStart ?? '' }),
        )
}

/** `rgb(r, g, b)` / `#rrggbb` -> `#rrggbb`, for contrastRatio. */
function toHex(css: string): string {
    const v = css.trim()
    if (v.startsWith('#')) return v.length === 4 ? `#${[...v.slice(1)].map(c => c + c).join('')}` : v
    const [r, g, b] = (v.match(/\d+/g) ?? ['0', '0', '0']).map(Number)
    return `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
}

/** The summary line spans several elements (each file name is its own nowrap span), so match the
 *  innermost element whose whole text is `text`. */
const whole =
    (text: string) =>
    (_: string, el: Element | null): boolean =>
        !!el &&
        el.textContent?.replace(/\s+/g, ' ').trim() === text &&
        ![...el.children].some(
            c => c.textContent?.replace(/\s+/g, ' ').trim() === text,
        )

const sheet = (root: HTMLElement) =>
    root.querySelector('[data-export-sheet]') as HTMLElement | null
const frameDoc = (root: HTMLElement) =>
    (root.querySelector('[data-export-sheet] iframe') as HTMLIFrameElement | null)
        ?.contentDocument ?? null

const twoPagePdf = async () =>
    new Uint8Array(
        buildLetterPdf([
            { label: 'Page one', color: [200, 60, 60] },
            { label: 'Page two', color: [60, 140, 60] },
        ]),
    )

const NOTE_PATH = 'projects/roadmap.md'
const NOTE_BODY = [
    '# Roadmap',
    '',
    'A short note with a **bold** word and a list:',
    '',
    '- first item',
    '- second item',
].join('\n')

const PAGED_PATH = 'projects/handout.md'
const PAGED_BODY = [
    '# Handout',
    '',
    'The first page.',
    '',
    '<!-- pagebreak -->',
    '',
    '## Second',
    '',
    'The second page.',
    '',
    '<!-- pagebreak -->',
    '',
    '## Third',
    '',
    'The last page.',
].join('\n')

const BASE_PATH = 'boards/tasks.md'
const BASE_BODY = ['---', 'type: base', 'view: cards', '---'].join('\n')

const CAL_PATH = 'plans/october.base.jsonl'
const CAL_BODY = [
    JSON.stringify({ type: 'base', view: 'calendar' }),
    JSON.stringify({ id: 'a1', title: 'Standup', date: '2026-10-05', startTime: '09:00', category: 'Work' }),
    JSON.stringify({ id: 'a2', title: 'Design review', date: '2026-10-14', startTime: '14:00', category: 'Work' }),
    JSON.stringify({ id: 'a3', title: 'Trip', date: '2026-10-22', category: 'Home' }),
].join('\n')

/** A plain note as PDF — the pane's default format. The desk is the PDF tab's own viewer: the real
 *  pdf.js pages edge to edge (no sheet frame around them), and the bar carries the PDF tab's
 *  `p. N / M` readout and `− 100% + fit` zoom. The rail's last line names the file it writes. */
export const NotePdf: Story = {
    render: () => {
        fresh()
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return (
            <Pane>
                <ExportView path={NOTE_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            const pdf = canvasElement.querySelector('[data-export-pdf]')
            expect(pdf?.querySelectorAll('canvas').length ?? 0).toBeGreaterThanOrEqual(2)
            expect(canvas.getByText('p. 1 / 2')).toBeInTheDocument()
            expect(canvas.getByText('100%')).toBeInTheDocument()
        })
        await waitFor(() => {
            const first = canvasElement.querySelector(
                '[data-export-pdf] canvas',
            ) as HTMLCanvasElement
            expect(inkedPct(first)).toBeGreaterThan(0.005)
        })
        expect(sheet(canvasElement)).toBeNull()
        expect(
            canvas.getByText(whole('writes roadmap.pdf → Downloads')),
        ).toBeInTheDocument()
        // One dropdown showing the current size, not a chip per size.
        expect(canvas.getByText('font size')).toBeInTheDocument()
        expect(canvas.getByText('12pt')).toBeInTheDocument()
        expect(canvas.queryByText('9pt')).toBeNull()
    },
}

/** The same note as HTML on the DARK sheet: the sheet is the app's own --bg on the darker desk,
 *  bounded by the full --border hairline so the page keeps its edge; the rendered note fills it. */
export const NoteHtmlDark: Story = {
    render: () => {
        fresh({ format: 'html' })
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return (
            <Pane>
                <ExportView path={NOTE_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(frameDoc(canvasElement)?.body?.textContent).toContain('Roadmap'),
        )
        const paper = sheet(canvasElement)!
        const cs = getComputedStyle(paper)
        expect(cs.outlineStyle).toBe('solid')
        expect(toHex(cs.backgroundColor)).not.toBe(
            toHex(getComputedStyle(paper.parentElement!).backgroundColor),
        )
        expect(canvas.queryByText('font size')).toBeNull()
        expect(
            canvas.getByText(whole('writes roadmap.html → Downloads')),
        ).toBeInTheDocument()
    },
}

/** The LIGHT export theme: the sheet is fixed print-cream, so its ink must come from the export
 *  palette, never from the app's own tokens (the app's `--fg` is 1.18:1 on cream in the default
 *  ink theme). The play measures the sheet's computed ink against its cream — all three ink tokens
 *  the sheet re-scopes — and the floor is 4.5:1 for text. It fails with the override removed. */
export const LightSheetInk: Story = {
    render: () => {
        fresh({ format: 'html', theme: 'light' })
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return (
            <Pane>
                <ExportView path={NOTE_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            const paper = sheet(canvasElement)!
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

/** A note split by `<!-- pagebreak -->` exported as PNG: a PNG holds one page, so the export writes
 *  one numbered file per page — the bar says "3 pages // 3 files" and the summary names the range
 *  before anything is written. */
export const NotePngPages: Story = {
    render: () => {
        fresh({ format: 'png' })
        setTransport(fakeTransport({ files: { [PAGED_PATH]: PAGED_BODY } }))
        return (
            <Pane>
                <ExportView path={PAGED_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText('3 pages // 3 files')).toBeInTheDocument()
            expect(
                canvas.getByText(whole('writes handout-1.png … handout-3.png → Downloads')),
            ).toBeInTheDocument()
        })
    },
}

/** A `type: base` cards view, Visual: the base's rows (resolved through `/rows`) render as the
 *  view's own cards on a landscape sheet, and the rail gains the visual/data choice a note never
 *  gets. */
export const BaseVisual: Story = {
    render: () => {
        fresh({ format: 'html' })
        setTransport(
            fakeTransport({
                files: { [BASE_PATH]: BASE_BODY },
                rows: SAMPLE_ROWS,
            }),
        )
        return (
            <Pane>
                <ExportView path={BASE_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText('visual')).toBeInTheDocument()
            expect(canvas.getByText('data')).toBeInTheDocument()
            const cards = frameDoc(canvasElement)?.querySelectorAll('.exp-card')
            expect(cards?.length ?? 0).toBe(SAMPLE_ROWS.length)
        })
        expect(canvas.queryByText('frontmatter')).toBeNull()
        expect(
            canvas.getByText(whole('writes tasks.html → Downloads')),
        ).toBeInTheDocument()
    },
}

/** The same base as Data: the flat table, and the toggle gains the two data-only formats. */
export const BaseData: Story = {
    render: () => {
        fresh({ format: 'csv' }, { path: BASE_PATH, mode: 'data' })
        setTransport(
            fakeTransport({
                files: { [BASE_PATH]: BASE_BODY },
                rows: SAMPLE_ROWS,
            }),
        )
        return (
            <Pane>
                <ExportView path={BASE_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText('csv')).toBeInTheDocument()
            expect(canvas.getByText('md')).toBeInTheDocument()
            expect(
                canvas.getByText(whole('writes tasks.csv → Downloads')),
            ).toBeInTheDocument()
        })
        // One preview line per file line — a header plus one per row — so a date like 2026-08-10
        // never wraps at its hyphen into a line the file does not have.
        await waitFor(() => {
            const pre = frameDoc(canvasElement)?.querySelector('pre')
            expect(pre).toBeTruthy()
            const lines = (pre?.textContent ?? '').split('\n').filter(l => l !== '')
            expect(lines.length).toBe(SAMPLE_ROWS.length + 1)
            const lineH = parseFloat(getComputedStyle(pre!).lineHeight)
            const padY =
                parseFloat(getComputedStyle(pre!).paddingTop) +
                parseFloat(getComputedStyle(pre!).paddingBottom)
            expect(Math.round((pre!.clientHeight - padY) / lineH)).toBe(lines.length)
        })
    },
}

/** A cards base whose source resolves no rows: the sheet says `no rows` in the view's body rather
 *  than handing over a blank page. */
export const BaseEmpty: Story = {
    render: () => {
        fresh({ format: 'html' })
        setTransport(
            fakeTransport({
                files: { [BASE_PATH]: BASE_BODY },
                rows: [],
            }),
        )
        return (
            <Pane>
                <ExportView path={BASE_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            const empty = frameDoc(canvasElement)?.querySelector('.exp-empty')
            expect(empty?.textContent).toBe('no rows')
        })
    },
}

/** A calendar base, Visual: the rail adds the grid's span and the day it starts on. Seeded to start
 *  on 2026-10-01 so the grid holds the base's three October events whatever today is. */
export const CalendarBase: Story = {
    render: () => {
        fresh(
            { format: 'html' },
            { path: CAL_PATH, mode: 'visual', calStart: '2026-10-01' },
        )
        setTransport(fakeTransport({ files: { [CAL_PATH]: CAL_BODY } }))
        return (
            <Pane>
                <ExportView path={CAL_PATH} htmlToPdf={twoPagePdf} />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText('span')).toBeInTheDocument()
            expect(canvas.getByText('month')).toBeInTheDocument()
            expect(canvas.getByText('starts')).toBeInTheDocument()
            expect(frameDoc(canvasElement)?.body?.textContent).toContain(
                'Standup',
            )
        })
        expect(
            canvas.getByText(whole('writes october.html → Downloads')),
        ).toBeInTheDocument()
    },
}

/** A re-render is smooth, the way the app hosts the pane: inside the pane's Suspense boundary
 *  (PaneSuspense). The reader scrolls to page 2 and flips the theme, which renders a new PDF. The
 *  rail never leaves the DOM (a re-render used to trip the boundary and swap the whole tab for its
 *  placeholder), and the new PDF opens on the page the reader was on, not back at page 1. */
let pdfRenders = 0
export const KeepsPlaceOnRerender: Story = {
    render: () => {
        fresh()
        pdfRenders = 0
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        const counted = () => {
            pdfRenders++
            return twoPagePdf()
        }
        return (
            <Pane>
                <PaneSuspense>
                    <ExportView path={NOTE_PATH} htmlToPdf={counted} />
                </PaneSuspense>
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByText('p. 1 / 2')).toBeInTheDocument(),
        )
        const scroller = () =>
            [...canvasElement.querySelectorAll<HTMLElement>('[data-export-pdf] *')].find(
                el => el.scrollHeight > el.clientHeight + 20,
            )
        await waitFor(() => expect(scroller()).toBeTruthy())
        const s = scroller()!
        s.scrollTop = s.scrollHeight
        s.dispatchEvent(new Event('scroll'))
        await waitFor(() =>
            expect(canvas.getByText('p. 2 / 2')).toBeInTheDocument(),
        )

        const rail = canvas.getByText('include')
        let railLeft = false
        const watch = new MutationObserver(records => {
            for (const r of records)
                for (const n of r.removedNodes)
                    if (n === rail || n.contains(rail)) railLeft = true
        })
        watch.observe(canvasElement, { childList: true, subtree: true })
        const before = pdfRenders
        canvas.getByText('light').click()
        await waitFor(() => expect(pdfRenders).toBeGreaterThan(before))
        await waitFor(() => {
            const first = canvasElement.querySelector(
                '[data-export-pdf] canvas',
            ) as HTMLCanvasElement | null
            expect(first && inkedPct(first)).toBeGreaterThan(0.005)
            expect(canvas.getByText('p. 2 / 2')).toBeInTheDocument()
        })
        watch.disconnect()
        expect(railLeft).toBe(false)
        expect(canvas.getByText('include')).toBe(rail)
    },
}
