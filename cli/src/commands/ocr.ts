// `bismuth ocr` — make a scanned PDF's text selectable. The argv shapes live in cli/src/ocr.ts; this
// file is the I/O. Reading a page's words into a note is `bismuth transcribe` (commands/transcribe.ts).
//
// The text layer is written to a hidden temp file beside the PDF and renamed over the original, so
// an open tab never reads a half-written PDF and the file watcher sees one change.
import { existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import { fileExists, resolveInVault } from '../../../core/src/files'
import { isPdfPath } from '../../../core/src/fileKinds'
import { createError } from '../../../core/src/error'
import { requireTool } from '../../../core/src/marker'
import { findTool, ocrmypdfArgs, parsePages, runTool, stderrTail, type OcrOptions } from '../ocr'

const BOOLS = [...BOOLEAN_FLAGS, 'force']

/** Words pdftotext finds, or null when pdftotext is not installed. */
async function pdfWords(abs: string): Promise<number | null> {
    const bin = findTool('pdftotext')
    if (!bin) return null
    const r = await runTool(bin, ['-q', abs, '-'])
    return r.code === 0 ? r.stdout.split(/\s+/).filter(Boolean).length : null
}

type LayerResult = {
    bytesBefore: number
    bytesAfter: number
    wordsBefore: number | null
    wordsAfter: number | null
}

/** Put a text layer into the PDF at `abs`, in place. */
async function addTextLayer(abs: string, opts: OcrOptions): Promise<LayerResult> {
    const bin = requireTool('ocrmypdf')
    const tmp = join(dirname(abs), `.${basename(abs)}.ocr-tmp.pdf`)
    const bytesBefore = statSync(abs).size
    const wordsBefore = await pdfWords(abs)
    try {
        const r = await runTool(bin, ocrmypdfArgs(abs, tmp, opts))
        if (r.code !== 0 || !existsSync(tmp))
            throw createError(
                'INTERNAL_ERROR',
                `ocrmypdf exited ${r.code}:\n${stderrTail(r.stderr)}`,
                500,
            )
        renameSync(tmp, abs)
    } finally {
        rmSync(tmp, { force: true })
    }
    return {
        bytesBefore,
        bytesAfter: statSync(abs).size,
        wordsBefore,
        wordsAfter: await pdfWords(abs),
    }
}

export const commands: CommandMap = {
    ocr: {
        summary:
            "Give a scanned PDF a selectable, highlightable text layer in place (to read a page's words into its note, run transcribe)",
        usage: '<file.pdf> [--force] [--lang eng] [--pages 1-3,7]',
        args: {
            positionals: ['path'],
            flags: {
                force: 'bool',
                lang: 'value',
                pages: 'value',
                vault: 'value',
                pretty: 'bool',
            },
        },
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args, BOOLS)
            if (!file) fail(`usage: ocr ${commands.ocr.usage}`)
            if (!isPdfPath(file))
                fail(`ocr adds a text layer to a PDF; to read an image into its note, run: bismuth transcribe ${file}`)
            if (!fileExists(vault, file))
                throw createError('ENOENT', `ocr: no such file: ${file}`)

            const pagesSpec = flag(args, 'pages')
            const pages = pagesSpec === undefined ? undefined : parsePages(pagesSpec)
            if (pages === null) fail(`--pages must look like 3, 1-4 or 1-3,7: ${pagesSpec}`)
            const lang = flag(args, 'lang')
            if (lang !== undefined && !/^[a-z_]+(\+[a-z_]+)*$/i.test(lang))
                fail(`--lang takes tesseract codes like eng or eng+deu: ${lang}`)
            const opts: OcrOptions = { force: bool(args, 'force'), lang, pages }
            const layer = await addTextLayer(resolveInVault(vault, file), opts)
            out({ ok: true, path: file, layer }, args)
        },
    },
}
