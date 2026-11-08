// `bismuth transcribe` — read an image or PDF into its companion note's transcript block. Runs the
// same core path as POST /transcribe in this process, so it needs no running app.
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, flag, out, positionals, requireVault } from '../args'
import { fileExists } from '../../../core/src/files'
import { companionPathFor } from '../../../core/src/fileKinds'
import { createError } from '../../../core/src/error'
import { writeTranscriptPage } from '../../../core/src/transcript'
import { transcribe, checkPageFile, registerAiTranscriber, type MathChoice } from '../../../core/src/transcribe'
import type { TranscribeEngine } from '../../../core/src/transcript'
import { agentDenyEntries, isDeniedPath } from '../../../core/src/visibilityFilter'
import { parsePages } from '../ocr'
import { markerStatus, startMarkerSetup, toolsDir } from '../../../core/src/markerSetup'

registerAiTranscriber(() => import('../../../core/src/aiTranscribe'))

const BOOLS = [...BOOLEAN_FLAGS, 'missing', 'stdin', 'progress']

/** `1-3,7` as [1, 2, 3, 7]. */
function expandPages(spec: string): number[] {
    const ranges = parsePages(spec)
    if (!ranges) fail(`--pages must look like 3, 1-4 or 1-3,7: ${spec}`)
    const pages: number[] = []
    for (const [a, b] of ranges) for (let p = a; p <= b; p++) pages.push(p)
    return pages
}

const STEP_WORDS = { uv: 'getting uv', marker: 'installing marker (about 1.1 GB)', 'llama-server': 'getting llama-server' } as const

export const commands: CommandMap = {
    'transcribe setup': {
        summary:
            "Install Marker, the local math reader auto uses for math pages, into ~/.bismuth/tools (uv, marker-pdf, llama-server; about 1.2 GB, Mac only); prints {installed, missing, dir}",
        usage: '',
        args: { positionals: [], flags: { vault: 'value', pretty: 'bool' } },
        run: async args => {
            let last = ''
            startMarkerSetup()
            for (;;) {
                const { job } = markerStatus()
                if (job.state === 'running' && job.step !== last) {
                    last = job.step
                    console.error(`transcribe setup: ${STEP_WORDS[job.step]}`)
                }
                if (job.state === 'failed') throw createError('INTERNAL_ERROR', `transcribe setup: ${job.step} failed: ${job.error}`)
                if (job.state === 'done') break
                await new Promise(r => setTimeout(r, 500))
            }
            const s = markerStatus()
            out({ installed: s.installed, missing: s.missing, dir: toolsDir() }, args)
        },
    },
    'transcribe': {
        summary:
            "Transcribe an image or PDF into its companion note, math as LaTeX (--engine auto, on-device, marker or ai; default: the transcription.engine setting); search and embeddings then index it",
        usage: '<file> [--engine auto|on-device|marker|ai] [--math careful|fast] [--pages 1-3,7] [--book <base>] [--missing] [--progress]',
        args: {
            positionals: ['path'],
            flags: {
                engine: 'value',
                math: 'value',
                pages: 'value',
                book: 'value',
                missing: 'bool',
                progress: 'bool',
                vault: 'value',
                pretty: 'bool',
            },
        },
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args, BOOLS)
            if (!file) fail(`usage: transcribe ${commands['transcribe'].usage}`)
            checkPageFile(file)
            const engine = flag(args, 'engine')
            if (engine !== undefined && !['auto', 'on-device', 'marker', 'ai'].includes(engine))
                fail(`--engine takes auto, on-device, marker or ai: ${engine}`)
            const math = flag(args, 'math')
            if (math !== undefined && math !== 'careful' && math !== 'fast')
                fail(`--math takes careful or fast: ${math}`)
            const pagesSpec = flag(args, 'pages')
            // A hidden page reads exactly like a missing one for an agent.
            const entries = await agentDenyEntries(vault)
            if (
                !fileExists(vault, file) ||
                isDeniedPath(entries, file) ||
                isDeniedPath(entries, companionPathFor(file))
            )
                throw createError('ENOENT', `transcribe: no such file: ${file}`)
            // --progress: one JSON line per page state change on stderr; Ctrl-C stops the run.
            const progress = bool(args, 'progress')
            const ctrl = new AbortController()
            const stop = () => ctrl.abort()
            if (progress) process.once('SIGINT', stop)
            out(
                await transcribe(vault, {
                    file,
                    engine: engine as TranscribeEngine | undefined,
                    pages: pagesSpec === undefined ? undefined : expandPages(pagesSpec),
                    book: flag(args, 'book'),
                    onlyMissing: bool(args, 'missing'),
                    ...(math ? { math: math as MathChoice } : {}),
                }, progress
                    ? { signal: ctrl.signal, onPage: p => console.error(JSON.stringify(p)) }
                    : {}).finally(() => process.off('SIGINT', stop)),
                args,
            )
        },
    },
    'transcript set': {
        summary:
            "Set one page's transcript text by hand in the file's companion note (keeps the other pages and the engine stamp; empty text removes the page's text)",
        usage: '<file> --page N (--text "..." | --stdin)',
        args: {
            positionals: ['path'],
            flags: { page: 'value', text: 'value', stdin: 'bool', vault: 'value', pretty: 'bool' },
        },
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args, BOOLS)
            if (!file) fail(`usage: transcript set ${commands['transcript set'].usage}`)
            const kind = checkPageFile(file)
            const pageSpec = flag(args, 'page')
            const page = Number(pageSpec)
            if (pageSpec === undefined || !Number.isInteger(page) || page < 1)
                fail(`--page takes a page number from 1: ${pageSpec ?? ''}`)
            const text = flag(args, 'text')
            if (text !== undefined && bool(args, 'stdin')) fail('give --text or --stdin, not both')
            if (text === undefined && !bool(args, 'stdin')) fail('give the text with --text "..." or --stdin')
            const entries = await agentDenyEntries(vault)
            const companion = companionPathFor(file)
            if (!fileExists(vault, file) || isDeniedPath(entries, file) || isDeniedPath(entries, companion))
                throw createError('ENOENT', `transcript set: no such file: ${file}`)
            await writeTranscriptPage(vault, companion, page, text ?? (await Bun.stdin.text()), kind)
            out({ ok: true, companion, page }, args)
        },
    },
}
