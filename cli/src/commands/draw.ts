import { readFileSync, writeFileSync } from 'node:fs'
import type { CommandMap } from '../types'
import {
    BOOLEAN_FLAGS,
    bool,
    flag,
    positionals,
    fail,
    out,
    requireVault,
} from '../args'
import { parseDocOrEmpty } from '../../../core/src/drawing/model'
import { listHighlights } from '../../../core/src/drawing/pageHighlights'
import { fileExists, resolveInVault } from '../../../core/src/files'
import { inkSidecarFor, isCompanionable, isPdfPath } from '../../../core/src/fileKinds'
import { getFileAccess } from '../../../core/src/fileAccess'
import { readPdfHighlights } from '../../../core/src/drawing/pdfHighlights'
import { pdfHighlightTexts } from '../../../core/src/drawing/pdfHighlightText'
import { resolveHighlightColor } from '../../../core/src/drawing/pageHighlights'
import {
    highlightIOFor,
    migrateSidecarHighlights,
} from '../../../core/src/pdfHighlightStore'
import { agentDenyEntries, isDeniedPath } from '../../../core/src/visibilityFilter'
import { createError } from '../../../core/src/error'
import {
    renderDocToPng,
    renderDocToPdf,
} from '../../../core/src/drawing/export'

/** Validate --theme, render a parsed `.draw` file to PNG or PDF (by `pdf`), write it to --out
 *  or a computed default filename, and print "wrote <path>". Shared by `draw render` and
 *  export's own `.draw` branch (export.ts) — both do exactly this once they've settled on a
 *  file and a pdf-vs-png format. */
export async function renderDrawFile(
    file: string,
    args: string[],
    pdf: boolean,
): Promise<void> {
    const themeArg = flag(args, 'theme') ?? 'dark'
    if (themeArg !== 'dark' && themeArg !== 'light')
        fail(`--theme must be "dark" or "light": ${themeArg}`)
    const theme = themeArg as 'dark' | 'light'
    const doc = parseDocOrEmpty(readFileSync(file, 'utf8'))
    const bytes = pdf
        ? await renderDocToPdf(doc, theme)
        : await renderDocToPng(doc, theme)
    const outPath = flag(args, 'out') ?? `${file}.${pdf ? 'pdf' : 'png'}`
    writeFileSync(outPath, bytes)
    out(`wrote ${outPath}`, args)
}

async function render(args: string[]): Promise<void> {
    const [file] = positionals(args)
    if (!file)
        fail('usage: <file.draw> [--pdf] [--out FILE] [--theme dark|light]')
    await renderDrawFile(file, args, bool(args, 'pdf'))
}

type HighlightRow = {
    page: number
    id: string
    color: string
    text: string | null
    store: 'pdf' | 'sidecar'
    y: number
    x: number
}

/** `bismuth highlights <file>`: the text a person highlighted in a PDF, page by page. A PDF's own
 *  highlights are standard annotations inside the file (so other apps' marks are listed too); any
 *  still in its `<file>.draw` sidecar are listed with them. An image reads its sidecar only. Takes
 *  the PDF/image or the sidecar path. */
async function highlights(args: string[]): Promise<void> {
    const vault = requireVault(args)
    const [file] = positionals(args, [...BOOLEAN_FLAGS, 'json'])
    if (!file) fail(`usage: highlights ${commands.highlights.usage}`)
    const source = file.endsWith('.draw') ? file.slice(0, -'.draw'.length) : file
    if (!isCompanionable(source))
        fail(`highlights takes a PDF or an image (or its .draw sidecar): ${file}`)
    const sidecar = inkSidecarFor(source)
    const hasSidecar = fileExists(vault, sidecar)
    if (!hasSidecar && !fileExists(vault, source))
        throw createError('ENOENT', `highlights: no such file: ${source}`)

    const rows: HighlightRow[] = []
    if (hasSidecar) {
        const doc = parseDocOrEmpty(readFileSync(resolveInVault(vault, sidecar), 'utf8'))
        doc.pages.forEach((pg, i) => {
            const byId = new Map(listHighlights({ ...doc, pages: [pg] }).map(e => [e.id, e]))
            for (const h of pg.highlights ?? []) {
                const e = byId.get(h.id)
                rows.push({
                    page: i + 1,
                    id: h.id,
                    color: e?.color ?? h.c,
                    text: e?.text ?? null,
                    store: 'sidecar',
                    y: h.rects[0]?.y ?? 0,
                    x: h.rects[0]?.x ?? 0,
                })
            }
        })
    }
    if (isPdfPath(source) && fileExists(vault, source)) {
        const io = highlightIOFor(await getFileAccess(), vault)
        const bytes = await io.readBinary(source)
        if (bytes) {
            const read = await readPdfHighlights(bytes)
            const texts = await pdfHighlightTexts(bytes, read.pages)
            read.pages.forEach((hs, i) =>
                hs.forEach((h, j) =>
                    rows.push({
                        page: i + 1,
                        id: h.id,
                        color: resolveHighlightColor(h.c),
                        text: texts[i]?.[j] ?? null,
                        store: 'pdf',
                        y: h.rects[0]?.y ?? 0,
                        x: h.rects[0]?.x ?? 0,
                    }),
                ),
            )
        }
    }
    rows.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)

    if (bool(args, 'json')) {
        const list = rows.map(({ page, id, color, text, store }) => ({
            page,
            id,
            color,
            text,
            store,
        }))
        out({ path: source, sidecar, count: list.length, highlights: list }, args)
        return
    }
    const lines = [
        `${source}: ${rows.length} highlight${rows.length === 1 ? '' : 's'}`,
    ]
    let page = 0
    for (const h of rows) {
        if (h.page !== page) {
            page = h.page
            lines.push('', `p. ${page}`)
        }
        lines.push(`- ${h.text ?? '(no text)'}`)
    }
    out(lines.join('\n'), args)
}

/** Move one PDF's sidecar highlights into the PDF; the report line says what happened. */
async function migrateOne(vault: string, pdf: string): Promise<string> {
    const io = highlightIOFor(await getFileAccess(), vault)
    const bytes = await io.readBinary(pdf)
    if (!bytes) throw createError('ENOENT', `highlights migrate: no such file: ${pdf}`)
    const state = await readPdfHighlights(bytes)
    if (!state.writable) return `${pdf}: kept in sidecar (${state.reason})`
    const { moved, writable } = await migrateSidecarHighlights(io, pdf)
    return writable ? `${pdf}: moved ${moved}` : `${pdf}: kept in sidecar (unreadable)`
}

/** `bismuth highlights migrate <file.pdf> | --all`: move sidecar highlights into the PDFs. */
async function migrate(args: string[]): Promise<void> {
    const vault = requireVault(args)
    const [given] = positionals(args, [...BOOLEAN_FLAGS, 'all'])
    const all = bool(args, 'all')
    if (!given && !all) fail('<file.pdf> or --all required')
    if (given && all) fail('pass <file.pdf> or --all, not both')
    if (given) {
        if (!isPdfPath(given)) fail(`highlights migrate takes a PDF: ${given}`)
        out(await migrateOne(vault, given), args)
        return
    }
    const entries = await agentDenyEntries(vault)
    const lines: string[] = []
    for (const rel of (await listPdfs(vault)).sort()) {
        if (isDeniedPath(entries, rel)) continue
        const sidecar = inkSidecarFor(rel)
        if (!fileExists(vault, sidecar) || isDeniedPath(entries, sidecar)) continue
        const doc = parseDocOrEmpty(readFileSync(resolveInVault(vault, sidecar), 'utf8'))
        if (!doc.pages.some(p => p.highlights?.length)) continue
        try {
            lines.push(await migrateOne(vault, rel))
        } catch (err) {
            lines.push(`${rel}: skipped (${err instanceof Error ? err.message : String(err)})`)
        }
    }
    out(lines.length ? lines.join('\n') : 'no sidecar highlights to migrate', args)
}

async function listPdfs(vault: string): Promise<string[]> {
    const found: string[] = []
    for await (const rel of new Bun.Glob('**/*.pdf').scan({ cwd: vault, dot: false }))
        found.push(rel)
    return found
}

export const commands: CommandMap = {
    highlights: {
        summary:
            'List the text highlighted in a PDF, page by page (the PDF\'s own annotations, plus any still in its .draw sidecar)',
        usage: '<file.pdf> [--json]',
        run: highlights,
    },
    'highlights migrate': {
        summary:
            'Move a PDF\'s sidecar highlights into the PDF itself; --all does every vault PDF whose sidecar has highlights',
        usage: '<file.pdf> | --all',
        run: migrate,
    },
    render: {
        summary: 'Render a .draw file to PNG (or --pdf), headless',
        usage: '<file.draw> [--pdf] [--out FILE] [--theme dark|light]',
        run: render,
    },
}
