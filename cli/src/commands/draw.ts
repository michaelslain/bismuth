import { readFileSync, writeFileSync } from 'node:fs'
import type { CommandMap } from '../types'
import { bool, flag, positionals, fail, out } from '../args'
import { parseDoc } from '../../../core/src/drawing/model'
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
    const doc = parseDoc(readFileSync(file, 'utf8'))
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

export const commands: CommandMap = {
    render: {
        summary: 'Render a .draw file to PNG (or --pdf), headless',
        usage: '<file.draw> [--pdf] [--out FILE] [--theme dark|light]',
        run: render,
    },
}
