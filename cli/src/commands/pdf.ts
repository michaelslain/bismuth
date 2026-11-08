// `bismuth pdf pages` — rewrite a vault PDF's pages.
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, fail, flag, out, positionals, requireVault } from '../args'
import { pdfPageCount, rewritePdfPages } from '../../../core/src/pdfPages'
import { companionPathFor, inkSidecarFor, isPdfPath } from '../../../core/src/fileKinds'
import { fileExists } from '../../../core/src/files'
import { createError } from '../../../core/src/error'
import { agentDenyEntries, isDeniedPath } from '../../../core/src/visibilityFilter'
import { parsePageOrder } from '../pageOrder'

const BOOLS = [...BOOLEAN_FLAGS]

export const commands: CommandMap = {
    'pdf pages': {
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
