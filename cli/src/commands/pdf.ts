// `bismuth pdf md` — convert a vault PDF into a new markdown note beside it (`x.pdf` → `x.md`),
// math as LaTeX, with a `source` property linking back to the PDF. The PDF is never written.
// The conversion lives in core/src/pdfMarkdown.ts, shared with the PDF bar's button.
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import { parsePages } from '../../../core/src/marker'
import { convertPdfToMarkdown } from '../../../core/src/pdfMarkdown'
import { pdfPageCount, rewritePdfPages } from '../../../core/src/pdfPages'
import { companionPathFor, inkSidecarFor, isPdfPath } from '../../../core/src/fileKinds'
import { fileExists } from '../../../core/src/files'
import { createError } from '../../../core/src/error'
import { agentDenyEntries, isDeniedPath } from '../../../core/src/visibilityFilter'
import { parsePageOrder } from '../pageOrder'

const BOOLS = [...BOOLEAN_FLAGS, 'force', 'replace']

export const commands: CommandMap = {
    'pdf md': {
        summary:
            'Convert a PDF to a new markdown note beside it (x.pdf → x.md, math as LaTeX, `source` links back); the PDF is untouched',
        usage: '<file.pdf> [--pages 1-3,7] [--force] [--replace]',
        args: {
            positionals: ['path'],
            flags: { pages: 'value', force: 'bool', replace: 'bool', vault: 'value', pretty: 'bool' },
        },
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args, BOOLS)
            if (!file) fail(`usage: pdf md ${commands['pdf md'].usage}`)
            const pagesSpec = flag(args, 'pages')
            const pages = pagesSpec === undefined ? undefined : parsePages(pagesSpec)
            if (pages === null) fail(`--pages must look like 3, 1-4 or 1-3,7: ${pagesSpec}`)
            const note = await convertPdfToMarkdown(vault, file, {
                pages,
                force: bool(args, 'force'),
                replace: bool(args, 'replace'),
            })
            out({ ok: true, path: file, note }, args)
        },
    },    'pdf pages': {
        summary:
            'Rewrite a PDF\'s pages: keep, reorder, delete, or insert pages from images, other PDFs and blanks; ink, highlights and transcript follow their page. Without --order prints the page count',
        usage: '<file.pdf> [--order 1,3,2,blank,@scans/a.png]',
        args: {
            positionals: ['path'],
            flags: { order: 'value', vault: 'value', pretty: 'bool' },
        },
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args, BOOLS)
            if (!file) fail(`usage: pdf pages ${commands['pdf pages'].usage}`)
            if (!isPdfPath(file)) fail(`not a pdf: ${file}`)
            const spec = flag(args, 'order')
            const parsed = spec === undefined ? null : parsePageOrder(spec)
            if (parsed && 'error' in parsed) fail(parsed.error)
            // A hidden pdf, sidecar, companion or source file reads exactly like a missing one for an agent.
            const entries = await agentDenyEntries(vault)
            const touched = [file, inkSidecarFor(file), companionPathFor(file)]
            for (const e of parsed?.order ?? []) if ('file' in e) touched.push(e.file)
            if (!fileExists(vault, file) || touched.some(p => isDeniedPath(entries, p)))
                throw createError('ENOENT', `pdf pages: no such file: ${file}`)
            out(parsed ? await rewritePdfPages(vault, file, parsed.order) : await pdfPageCount(vault, file), args)
        },
    },
}
