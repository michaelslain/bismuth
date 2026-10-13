// `bismuth ocr` — make a PDF's text selectable, and transcribe a PDF or image (math as LaTeX) into a
// sibling note. The argv shapes live in cli/src/ocr.ts and Marker in core/src/marker.ts; this file is the I/O.
//
// A PDF always gets its text layer, written to a hidden temp file beside it and renamed over the
// original, so an open tab never reads a half-written PDF and the file watcher sees one change.
// `--math` (and any image, which has no text layer to add) also writes `<name>.ocr.md`.
import { existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import { fileExists, resolveInVault, writeNote } from '../../../core/src/files'
import { isPdfPath } from '../../../core/src/fileKinds'
import { createError } from '../../../core/src/error'
import { markerTranscribe, requireTool } from '../../../core/src/marker'
import {
    findTool,
    isOcrablePath,
    ocrNote,
    ocrNotePath,
    ocrmypdfArgs,
    parsePages,
    runTool,
    stderrTail,
    tesseractArgs,
    type OcrOptions,
} from '../ocr'

const BOOLS = [...BOOLEAN_FLAGS, 'math', 'force', 'replace']

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

/** Plain-text OCR of an image with tesseract. */
async function tesseractTranscribe(abs: string, opts: OcrOptions): Promise<string> {
    const r = await runTool(requireTool('tesseract'), tesseractArgs(abs, opts))
    if (r.code !== 0)
        throw createError(
            'INTERNAL_ERROR',
            `tesseract exited ${r.code}:\n${stderrTail(r.stderr)}`,
            500,
        )
    return r.stdout
}

export const commands: CommandMap = {
    ocr: {
        summary:
            "OCR a PDF or image: give a PDF a selectable text layer in place; --math also transcribes it (math as LaTeX) to <name>.ocr.md beside it",
        usage: '<file> [--math] [--force] [--lang eng] [--pages 1-3,7] [--replace]',
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args, BOOLS)
            if (!file) fail(`usage: ocr ${commands.ocr.usage}`)
            if (!isOcrablePath(file))
                fail(`ocr takes a PDF or a png/jpg/tif/webp/bmp image: ${file}`)
            if (!fileExists(vault, file))
                throw createError('ENOENT', `ocr: no such file: ${file}`)

            const pagesSpec = flag(args, 'pages')
            const pages = pagesSpec === undefined ? undefined : parsePages(pagesSpec)
            if (pages === null) fail(`--pages must look like 3, 1-4 or 1-3,7: ${pagesSpec}`)
            const lang = flag(args, 'lang')
            if (lang !== undefined && !/^[a-z_]+(\+[a-z_]+)*$/i.test(lang))
                fail(`--lang takes tesseract codes like eng or eng+deu: ${lang}`)
            const opts: OcrOptions = { force: bool(args, 'force'), lang, pages }

            const pdf = isPdfPath(file)
            const math = bool(args, 'math')
            const notePath = pdf && !math ? null : ocrNotePath(file)
            if (notePath && fileExists(vault, notePath) && !bool(args, 'replace'))
                throw createError(
                    'EEXIST',
                    `ocr: ${notePath} already exists — pass --replace to rewrite it`,
                )

            const abs = resolveInVault(vault, file)
            const result: Record<string, unknown> = { ok: true, path: file }
            // Transcribe before the text layer goes in: Marker reads a PDF's existing text where it
            // trusts it, and tesseract's reading of an equation is exactly what it must not trust.
            if (notePath) {
                const body = math
                    ? await markerTranscribe(abs, opts)
                    : await tesseractTranscribe(abs, opts)
                await writeNote(vault, notePath, ocrNote(body, basename(file)))
                result.note = notePath
                result.engine = math ? 'marker' : 'tesseract'
            }
            if (pdf) result.layer = await addTextLayer(abs, opts)
            out(result, args)
        },
    },
}
