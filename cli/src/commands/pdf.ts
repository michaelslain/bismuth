// `bismuth pdf md` — convert a vault PDF into a new markdown note beside it (`x.pdf` → `x.md`),
// math as LaTeX, with a `source` property linking back to the PDF. The PDF is never written.
// The conversion lives in core/src/pdfMarkdown.ts, shared with the PDF bar's button.
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import { parsePages } from '../../../core/src/marker'
import { convertPdfToMarkdown } from '../../../core/src/pdfMarkdown'

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
    },
}
