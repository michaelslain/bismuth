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
import { inkSidecarFor, isCompanionable } from '../../../core/src/fileKinds'
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

/** `bismuth highlights <file>`: the text a person highlighted in a PDF, page by page. The marks
 *  are not in the PDF itself; they live in its `<file>.draw` sidecar, so an agent that renders the
 *  PDF sees none of them. Takes the PDF/image or the sidecar path. */
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
    const list = hasSidecar
        ? listHighlights(
              parseDocOrEmpty(readFileSync(resolveInVault(vault, sidecar), 'utf8')),
          )
        : []

    if (bool(args, 'json')) {
        out({ path: source, sidecar, count: list.length, highlights: list }, args)
        return
    }
    const lines = [
        `${source}: ${list.length} highlight${list.length === 1 ? '' : 's'}`,
    ]
    let page = 0
    for (const h of list) {
        if (h.page !== page) {
            page = h.page
            lines.push('', `p. ${page}`)
        }
        lines.push(`- ${h.text ?? '(saved without its text)'}`)
    }
    out(lines.join('\n'), args)
}

export const commands: CommandMap = {
    highlights: {
        summary:
            "List the text highlighted in a PDF, page by page (read from its .draw sidecar, not the PDF)",
        usage: '<file.pdf> [--json]',
        run: highlights,
    },
    render: {
        summary: 'Render a .draw file to PNG (or --pdf), headless',
        usage: '<file.draw> [--pdf] [--out FILE] [--theme dark|light]',
        run: render,
    },
}
