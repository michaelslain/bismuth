// core/src/marker.ts
// The external-engine plumbing shared by `bismuth ocr` (cli/src/commands/ocr.ts) and PDF → markdown
// (pdfMarkdown.ts, behind `bismuth pdf md`, the `pdf_to_markdown` MCP tool and the PDF bar's
// button): finding an engine binary on a short PATH, running it, and Marker (marker-pdf, run
// through llama.cpp's llama-server), which transcribes a PDF or image to markdown with math as
// `$…$` / `$$…$$` LaTeX.
//
// It lives in core rather than cli because the core server runs it too, and core must not import
// the cli. Nothing here imports Bun: `runTool` reaches the `Bun` global only when called, which no
// mobile code path does.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { isPdfPath } from './fileKinds'
import { createError } from './error'

/** A 1-based page selection, `3` / `1-4` / `1-3,7,9-10`. */
const PAGES_RE = /^\d+(-\d+)?(,\d+(-\d+)?)*$/

/** Validate a 1-based page selection; returns its ranges, or null when malformed or a range
 *  runs backwards or includes page 0. */
export function parsePages(spec: string): [number, number][] | null {
    const s = spec.replace(/\s+/g, '')
    if (!PAGES_RE.test(s)) return null
    const ranges: [number, number][] = []
    for (const part of s.split(',')) {
        const [a, b] = part.split('-').map(Number)
        const end = b ?? a
        if (a < 1 || end < a) return null
        ranges.push([a, end])
    }
    return ranges
}

/** Marker counts pages from 0. */
export function markerPages(ranges: [number, number][]): string {
    return ranges
        .map(([a, b]) => (a === b ? `${a - 1}` : `${a - 1}-${b - 1}`))
        .join(',')
}

export type OcrOptions = {
    force?: boolean
    /** Tesseract language codes, `eng` or `eng+deu`. */
    lang?: string
    pages?: [number, number][]
}

/** The marker_single argv that writes `<outDir>/<stem>/<stem>.md`. Image extraction is off: the
 *  note is a transcription, and the figures are still in the PDF it links to. */
export function markerArgs(
    input: string,
    outDir: string,
    opts: OcrOptions = {},
): string[] {
    const argv = [
        input,
        '--output_dir',
        outDir,
        '--output_format',
        'markdown',
        '--disable_image_extraction',
    ]
    // An earlier `bismuth ocr` left tesseract's invisible text in the PDF; Marker would read
    // that garbled math back instead of transcribing the page. Real vector text is kept.
    if (isPdfPath(input)) argv.push('--strip_existing_ocr')
    if (opts.force) argv.push('--force_ocr')
    if (opts.pages && isPdfPath(input))
        argv.push('--page_range', markerPages(opts.pages))
    return argv
}

/** Marker pads inline math with two spaces (`rate  $\eta$  the`). Collapse runs of spaces inside
 *  each line, leaving fenced code and leading indentation as written, and end with one newline. */
export function tidyMarkdown(md: string): string {
    let fenced = false
    const lines = md.replace(/\r\n/g, '\n').split('\n')
    const out = lines.map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced
            return line
        }
        if (fenced) return line
        const indent = /^\s*/.exec(line)![0]
        return indent + line.slice(indent.length).replace(/ {2,}/g, ' ').trimEnd()
    })
    return joinMathContinuations(out).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Marker breaks a sentence before inline math into its own paragraph, marked by one leading
 *  space: `learning rate` / blank / ` $\eta > 0$ the update is`. Rejoin such a line onto the
 *  paragraph above when that paragraph is prose that has not ended its sentence. Display math
 *  (`$$`) and anything indented further are left alone. */
function joinMathContinuations(lines: string[]): string[] {
    const out: string[] = []
    for (const line of lines) {
        const prevBlank = out.length >= 2 && out[out.length - 1] === ''
        const prev = prevBlank ? out[out.length - 2]! : ''
        if (
            prevBlank &&
            /^ \$(?!\$)/.test(line) &&
            /[\p{L}\p{N},]$/u.test(prev) &&
            !/^\s*([#>|]|[-*+] |\d+\. |```|~~~|\$\$)/.test(prev)
        ) {
            out.pop()
            out[out.length - 1] = `${prev} ${line.trimStart()}`
            continue
        }
        out.push(line)
    }
    return out
}

/** A transcription note for `sourceName` (a basename): a `source` link back to the file, then
 *  the markdown. */
export function sourcedNote(body: string, sourceName: string): string {
    const link = JSON.stringify(`[[${sourceName}]]`)
    return `---\nsource: ${link}\n---\n\n${tidyMarkdown(body)}`
}

/** Directories searched after PATH. A daemon or app-spawned agent often runs with a minimal PATH
 *  that misses Homebrew and `uv tool install`'s `~/.local/bin`. */
export function extraToolDirs(home: string = homedir()): string[] {
    return ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin')]
}

/** PATH with the extra tool dirs appended, so an engine finds its own helpers (Marker spawns
 *  llama-server; ocrmypdf spawns tesseract and Ghostscript). */
export function toolPath(env: Record<string, string | undefined> = process.env): string {
    const parts = (env.PATH ?? '').split(delimiter).filter(Boolean)
    for (const d of extraToolDirs(env.HOME ?? homedir()))
        if (!parts.includes(d)) parts.push(d)
    return parts.join(delimiter)
}

/** Absolute path of an engine binary, or null when it is not installed. */
export function findTool(
    name: string,
    env: Record<string, string | undefined> = process.env,
): string | null {
    for (const dir of toolPath(env).split(delimiter)) {
        const p = join(dir, name)
        if (existsSync(p)) return p
    }
    return null
}

/** What to install when an engine is missing. */
export const INSTALL_HINTS: Record<string, string> = {
    ocrmypdf: 'brew install ocrmypdf',
    tesseract: 'brew install tesseract',
    marker_single: 'uv tool install marker-pdf',
    'llama-server': 'brew install llama.cpp',
}

/** The engine's absolute path, or an ENOENT error naming the install command. */
export function requireTool(name: string, verb = 'ocr'): string {
    const bin = findTool(name)
    if (!bin)
        throw createError(
            'ENOENT',
            `${verb} needs ${name}, which is not installed — run: ${INSTALL_HINTS[name] ?? name}`,
        )
    return bin
}

export type ToolRun = { code: number; stdout: string; stderr: string }

/** Run an engine to completion with the widened PATH. Never throws on a non-zero exit. */
export async function runTool(bin: string, argv: string[]): Promise<ToolRun> {
    const proc = Bun.spawn([bin, ...argv], {
        env: { ...process.env, PATH: toolPath() },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

/** The last few non-empty lines of an engine's stderr, for an error message. */
export function stderrTail(stderr: string, lines = 6): string {
    return stderr
        .split('\n')
        .map(l => l.trimEnd())
        .filter(Boolean)
        .slice(-lines)
        .join('\n')
}

/** Marker writes `<outDir>/<stem>/<stem>.md`; take the one markdown file it produced. */
function findMarkdown(outDir: string): string | null {
    for (const sub of readdirSync(outDir)) {
        const dir = join(outDir, sub)
        if (!statSync(dir).isDirectory()) continue
        const md = readdirSync(dir).find(f => f.endsWith('.md'))
        if (md) return join(dir, md)
    }
    return null
}

/** Transcribe the file at absolute path `abs` with Marker (math as LaTeX); returns the raw
 *  markdown. `verb` names the caller in a missing-engine error. */
export async function markerTranscribe(
    abs: string,
    opts: OcrOptions = {},
    verb = 'ocr',
): Promise<string> {
    const bin = requireTool('marker_single', verb)
    requireTool('llama-server', verb)
    const outDir = mkdtempSync(join(tmpdir(), 'bismuth-marker-'))
    try {
        const r = await runTool(bin, markerArgs(abs, outDir, opts))
        const md = findMarkdown(outDir)
        if (r.code !== 0 || !md)
            throw createError(
                'INTERNAL_ERROR',
                `marker exited ${r.code}:\n${stderrTail(r.stderr)}`,
                500,
            )
        return await readFile(md, 'utf8')
    } finally {
        rmSync(outDir, { recursive: true, force: true })
    }
}
