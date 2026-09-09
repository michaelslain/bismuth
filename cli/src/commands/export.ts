// Universal `export` — note / base / sheet / drawing → md | html | png | pdf.
// Reuses the app's own exporter (app/src/export/exporters.ts) so CLI output matches
// the in-app export exactly, injecting headless deps. Every format is fully headless:
// pdf/png of notes/bases/sheets drive real headless Chrome over CDP
// (core/src/render/htmlRaster.ts) against the exact HTML the browser exporter itself
// produces, so there is no fidelity gap against what the app shows. Drawings go straight
// through the headless core renderer (core/src/drawing/export.ts).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CommandMap } from '../types'
import { flag, bool, requireVault, fail, today, out } from '../args'
import { readNote } from '../../../core/src/files'
import { resolveSource } from '../../../core/src/bases/source'
import { parseDoc } from '../../../core/src/drawing/model'
import {
    renderDocToPng,
    renderDocToPdf,
} from '../../../core/src/drawing/export'
import {
    htmlToPdfHeadless,
    htmlToPngHeadless,
    htmlToPdfPagesHeadless,
} from '../../../core/src/render/htmlRaster'
import { renderExport } from '../../../app/src/export/exporters'
import { defaultExportOptions } from '../../../app/src/export/options'
import type {
    ExportFormat,
    ExportDeps,
    ExportOptions,
    RenderMode,
    CalSpan,
} from '../../../app/src/export/types'

// A self-contained KaTeX stylesheet for the CLI's headless exports, built at runtime instead
// of importing the app's `katexCss.ts`. That module leans on Vite's `?raw`/`?inline` import
// suffixes to bundle the CSS text and every glyph font as data: URIs at BUILD time — machinery
// only Vite provides, so it cannot resolve inside a bun-compiled binary (`bismuth build`) or
// even under plain `bun run`. Here the same result (inlined stylesheet, inlined fonts, no
// on-disk font paths) is produced by reading the resolved `katex` package straight off disk.
let cachedKatexCss: string | null = null
async function katexCss(): Promise<string> {
    if (cachedKatexCss !== null) return cachedKatexCss
    try {
        const cssPath = require.resolve('katex/dist/katex.min.css')
        const fontDir = join(dirname(cssPath), 'fonts')
        const raw = readFileSync(cssPath, 'utf8')
        cachedKatexCss = raw.replace(
            /url\(fonts\/(KaTeX_[\w-]+)\.woff2\)\s*format\("woff2"\)(?:\s*,\s*url\(fonts\/[\w.-]+\)\s*format\("[^"]+"\))*/g,
            (whole, name: string) => {
                try {
                    const woff2 = readFileSync(join(fontDir, `${name}.woff2`))
                    const dataUrl = `data:font/woff2;base64,${woff2.toString('base64')}`
                    return `url(${dataUrl}) format("woff2")`
                } catch {
                    return whole
                }
            },
        )
    } catch {
        // No resolvable katex package (shouldn't happen — it's a cli dependency) — fall back to
        // unstyled math rather than failing the whole export.
        cachedKatexCss = ''
    }
    return cachedKatexCss
}

// Base-export options from flags (no-ops for non-base files). `--view` picks which view,
// `--mode data|visual` flat-table vs rendered view, `--cal-start`/`--cal-span` the calendar
// grid anchor + span.
function optionsFrom(args: string[]): ExportOptions {
    const o = defaultExportOptions()
    const view = flag(args, 'view')
    if (view !== undefined) o.viewIndex = Math.max(0, parseInt(view, 10) || 0)
    const mode = flag(args, 'mode')
    if (mode === 'visual' || mode === 'data') o.mode = mode as RenderMode
    const start = flag(args, 'cal-start')
    if (start) o.calStart = start
    const span = flag(args, 'cal-span')
    if (
        span === 'month' ||
        span === 'week' ||
        span === '3day' ||
        span === 'day'
    )
        o.calSpan = span as CalSpan
    if (bool(args, 'no-frontmatter')) o.includeFrontmatter = false
    // Default is now off (clean formatting) — this flag turns markdown-syntax markers ON.
    if (bool(args, 'markdown-syntax')) o.showMarkdownSyntax = true
    return o
}

async function run(args: string[]): Promise<void> {
    const file = args.find(a => !a.startsWith('--'))
    if (!file)
        fail(
            'usage: bismuth export <file> [--format md|html|png|pdf|csv] [--out FILE] [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day] [--no-frontmatter] [--markdown-syntax] [--theme dark|light]',
        )
    const fmt = (flag(args, 'format') ??
        (file.endsWith('.draw') ? 'png' : 'md')) as ExportFormat
    const themeArg = flag(args, 'theme') ?? 'dark'
    if (themeArg !== 'dark' && themeArg !== 'light')
        fail(`--theme must be "dark" or "light": ${themeArg}`)
    const theme = themeArg as 'dark' | 'light'

    // Drawings: headless core renderer (both png + pdf work without a browser).
    if (file.endsWith('.draw')) {
        const doc = parseDoc(readFileSync(file, 'utf8'))
        if (fmt !== 'png' && fmt !== 'pdf')
            fail('a .draw file exports to png or pdf')
        const bytes =
            fmt === 'pdf'
                ? await renderDocToPdf(doc, theme)
                : await renderDocToPng(doc, theme)
        const outPath = flag(args, 'out') ?? `${file}.${fmt}`
        writeFileSync(outPath, bytes)
        out(`wrote ${outPath}`, args)
        return
    }

    // Notes / bases / sheets: reuse the app exporter with headless deps.
    const vault = requireVault(args)
    const deps: ExportDeps = {
        read: p => readNote(vault, p),
        resolveRows: spec =>
            resolveSource(spec, { root: vault, today: today() }),
        // Headless: drives real Chrome over CDP (core/src/render/htmlRaster.ts) against the
        // exact HTML the browser exporter itself produces — no running Bismuth, no fidelity
        // gap against the app's own export.
        htmlToPdf: htmlToPdfHeadless,
        htmlToPdfPages: htmlToPdfPagesHeadless,
        htmlToPng: htmlToPngHeadless,
        // Inline KaTeX stylesheet + fonts read straight off the resolved `katex` package at
        // runtime — see katexCss() above for why this can't just reuse the app's katexCss.ts.
        katexCss,
        drawingToPng: async (docText, theme) => {
            const bytes = await renderDocToPng(parseDoc(docText), theme)
            return {
                bytes,
                dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
            }
        },
    }
    const res = await renderExport(file, fmt, deps, theme, optionsFrom(args))
    // A `<!-- pagebreak -->`-split PNG note (see app/src/export/pageBreaks.ts) yields several
    // files, one per page — `--out` (a single path) doesn't apply, so each writes to its own
    // computed name. Unreachable today for the app-only png/pdf-of-notes paths above (they throw
    // before producing bytes), kept for when a headless PNG rasterizer lands.
    if (res.files && res.files.length > 1) {
        for (const f of res.files) writeFileSync(f.filename, f.bytes)
        out(`wrote ${res.files.map(f => f.filename).join(', ')}`, args)
        return
    }
    const outPath = flag(args, 'out') ?? res.filename
    writeFileSync(outPath, res.bytes)
    out(`wrote ${outPath}`, args)
}

export const commands: CommandMap = {
    export: {
        summary:
            'Export a note/base/sheet/drawing to md|html|png|pdf|csv',
        usage: '<file> [--format md|html|png|pdf|csv] [--out FILE] [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day] [--no-frontmatter] [--markdown-syntax] [--theme dark|light] [--vault <dir>]',
        run,
    },
}
