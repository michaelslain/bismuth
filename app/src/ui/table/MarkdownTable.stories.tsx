// Visual spec for <MarkdownTable> — the frame rendered markdown (a chat message, a card face, a
// transclusion) puts around a markdown table. The table itself is the one a note renders
// (typeTable.ts; Editor.stories.tsx's TableMatchesChat shows the two side by side); what this story
// covers is the frame's part: a narrow column, the sideways scroll when a table cannot fit it, a
// table inside a callout, and a `:--`/`--:` column's alignment. Each story renders its markdown
// through the renderNoteBody pipeline and hands MarkdownTable the resulting `<table>`, or types a
// whole rendered body through typeTables.ts.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { renderNoteBody } from '../../bases/markdown'
import MarkdownTable from './MarkdownTable'
import { createResource, Show } from 'solid-js'
import { createTypedTables } from './typeTables'
import { typeExportTables } from './exportTables'
import { wrapHtmlDocument } from '../../export/htmlTemplate'
import { htmlToPng } from '../../export/htmlToPdf'

const meta = {
    title: 'UI/Table/MarkdownTable',
    component: MarkdownTable,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MarkdownTable>

export default meta
type Story = StoryObj<typeof meta>

const tableOf = (md: string) => {
    const host = document.createElement('div')
    host.innerHTML = renderNoteBody(md)
    return host.querySelector('table') as HTMLTableElement
}

const summaryTable = [
    '| file | what changed | status |',
    '| --- | --- | --- |',
    '| `app/src/chat/ChatTextBubble.module.css` | cells keep whole words, so a short column never splits mid-letter | done |',
    '| `core/src/vault.ts` | rename moves the companion note with the file | done |',
    '| `docs/chat/overview.md` | tables section | todo |',
].join('\n')

const wideTable = [
    '| step | command | result | took | workspace | machine | notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| typecheck | `bun run typecheck` | pass | 41s | everything | laptop | all seven workspaces |',
    '| tests | `bun test core/test/vault.test.ts` | pass | 3s | core | laptop | one file |',
    '| visual | `bun run visual --base http://localhost:6201` | 2 flags | 1m12s | app | desktop | both are the known calendar flake |',
].join('\n')

const Column = (props: { width: number; md: string; id: string }) => {
    // built once: a `table={tableOf(…)}` prop is a getter, and every read would build a new table
    const table = tableOf(props.md)
    return (
        <div style={{ width: `${props.width}px` }} data-testid={props.id}>
            <MarkdownTable {...{ table }} />
        </div>
    )
}

/** A table as an agent writes one — a code-path column, a prose column, a one-word column — in the
 *  360px transcript and at 600px, plus a seven-column table that cannot fit 360px in whole words. Columns
 *  size to their content: a one-word column takes its word's width and never wraps, no word splits
 *  mid-letter, a path wraps at its `/` and `.` joints, the prose column absorbs the wrapping, and a
 *  table too wide even in whole words breaks inside words to fit its frame instead of spilling out. */
export const AutoSizedColumns: Story = {
    args: { table: document.createElement('table') },
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '24px' }}
        >
            <Column width={360} md={summaryTable} id="narrow" />
            <Column width={600} md={summaryTable} id="wide" />
            <Column width={360} md={wideTable} id="overflow" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        for (const id of ['narrow', 'wide', 'overflow']) {
            const host = canvasElement.querySelector(
                `[data-testid="${id}"]`,
            ) as HTMLElement
            const frame = host.querySelector(
                '[data-markdown-table]',
            ) as HTMLElement
            // the frame never widens its column: overflow scrolls inside it
            await expect(
                frame.getBoundingClientRect().width,
            ).toBeLessThanOrEqual(host.clientWidth + 0.5)
            // every cell types its own edges
            for (const cell of Array.from(host.querySelectorAll('th, td')))
                await expect(cell.querySelector('[data-edges]')).not.toBeNull()
            // a table that fits in whole words never splits one: a one-word cell stays on one line
            if (id === 'overflow') continue
            for (const td of Array.from(host.querySelectorAll('td'))) {
                if (
                    td.querySelector('code') ||
                    !/^\S+$/.test(td.textContent!.trim())
                )
                    continue
                const range = document.createRange()
                range.selectNodeContents(td.firstChild!)
                const lines = new Set(
                    Array.from(range.getClientRects()).map(r =>
                        Math.round(r.top),
                    ),
                )
                await expect(lines.size).toBe(1)
            }
        }
        const overflow = canvasElement.querySelector(
            '[data-testid="overflow"] [data-markdown-table]',
        ) as HTMLElement
        // too wide in whole words, it squeezes to fit rather than spill past the frame
        await expect(
            overflow.querySelector('table')!.hasAttribute('data-squeezed'),
        ).toBe(true)
        await expect(overflow.scrollWidth).toBeLessThanOrEqual(
            overflow.clientWidth + 1,
        )
        for (const id of ['narrow', 'wide'])
            await expect(
                canvasElement
                    .querySelector(`[data-testid="${id}"] table`)!
                    .hasAttribute('data-squeezed'),
            ).toBe(false)
        // the frame scrolls sideways only: a vertical wheel over it passes to the transcript, which
        // global.css's app-wide `overscroll-behavior: none` would otherwise stop at the frame
        await expect(getComputedStyle(overflow).overflowY).toBe('hidden')
        await expect(getComputedStyle(overflow).overscrollBehaviorY).toBe(
            'auto',
        )
        // a path wraps at its joints, never mid-segment: every code token's pieces are intact
        const code = canvasElement.querySelector(
            '[data-testid="narrow"] td code',
        )!
        await expect(code.querySelectorAll('wbr').length).toBeGreaterThan(0)
        await expect(code.textContent).toBe(
            'app/src/chat/ChatTextBubble.module.css',
        )
    },
}

const calloutWithTable = [
    '> [!note] Release checklist',
    '> | step | owner | days |',
    '> | :-- | --- | --: |',
    '> | write the notes | docs | 2 |',
    '> | cut the build | release | 14 |',
].join('\n')

/** A rendered body as card faces and transclusions show one: a callout holding a table, typed by
 *  typeTables.ts like any other table in the body. The `:--` column sits left and the `--:` column
 *  sits right — marked's `align` attribute alone is outranked by the shared cell rule. */
const Body = (props: { md: string; width: number }) => {
    let host!: HTMLDivElement
    const el = (
        <div
            ref={host}
            style={{ width: `${props.width}px` }}
            data-testid="body"
            innerHTML={renderNoteBody(props.md)}
        />
    )
    createTypedTables(
        () => host,
        () => props.md,
    )
    return el
}

export const CalloutTable: Story = {
    args: { table: document.createElement('table') },
    render: () => <Body md={calloutWithTable} width={420} />,
    play: async ({ canvasElement }) => {
        const body = canvasElement.querySelector(
            '[data-testid="body"]',
        ) as HTMLElement
        const table = body.querySelector('.callout table') as HTMLElement
        await expect(table.classList.contains('bismuth-table')).toBe(true)
        await expect(table.closest('[data-markdown-table]')).not.toBeNull()
        for (const cell of Array.from(table.querySelectorAll('th, td')))
            await expect(cell.querySelector('[data-edges]')).not.toBeNull()
        const days = table.querySelector(
            'tbody tr td:last-child',
        ) as HTMLElement
        await expect(getComputedStyle(days).textAlign).toBe('right')
        const step = table.querySelector('tbody tr td') as HTMLElement
        await expect(getComputedStyle(step).textAlign).toBe('left')
    },
}

/** The same callout table through an export's html2canvas raster (the PNG export, and the PDF
 *  outside the desktop app): html2canvas cannot paint the grid's mask, so exportTables.ts bakes each
 *  cell's glyphs to an image first. Unbaked, every cell's overlay paints as a solid block of ink;
 *  the play reads the raster back and holds the inked share of the image to what text and a dashed
 *  grid cover. */
export const ExportRaster: Story = {
    args: { table: document.createElement('table') },
    render: () => {
        const [png] = createResource(async () => {
            const typed = await typeExportTables(
                renderNoteBody(calloutWithTable),
            )
            const doc = wrapHtmlDocument(
                typed.html,
                'raster',
                undefined,
                `<style>${typed.css}</style>`,
            )
            return (await htmlToPng(doc)).dataUrl
        })
        return (
            <Show when={png()}>
                <img
                    src={png()}
                    data-testid="raster"
                    style={{ width: '600px' }}
                    alt="exported table"
                />
            </Show>
        )
    },
    play: async ({ canvasElement }) => {
        const img = await waitFor(
            () => {
                const el = canvasElement.querySelector(
                    '[data-testid="raster"]',
                ) as HTMLImageElement | null
                expect(el?.naturalWidth).toBeGreaterThan(0)
                return el!
            },
            { timeout: 15000 },
        )
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const px = ctx.getImageData(0, 0, c.width, c.height).data
        const bg = [px[0], px[1], px[2]]
        let inked = 0
        for (let i = 0; i < px.length; i += 4)
            if (
                Math.abs(px[i] - bg[0]) +
                    Math.abs(px[i + 1] - bg[1]) +
                    Math.abs(px[i + 2] - bg[2]) >
                24
            )
                inked++
        // baked ~3%, unbaked (a solid block per cell) ~13%
        await expect(inked / (px.length / 4)).toBeLessThan(0.08)
    },
}
