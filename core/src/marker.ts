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
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs'
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
    marker_single: "uv tool install 'marker-pdf>=2,<3'",
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

/** How long a stopped engine's helpers get to exit on SIGTERM before SIGKILL. */
export const STOP_GRACE_MS = 10_000

/** Every process below `pid`, read from `ps` (children before grandchildren). */
export function descendants(pid: number): number[] {
    const out = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=']).stdout.toString()
    const kids = new Map<number, number[]>()
    for (const line of out.split('\n')) {
        const [c, p] = line.trim().split(/\s+/).map(Number)
        if (!c || p === undefined) continue
        kids.set(p, [...(kids.get(p) ?? []), c])
    }
    const found: number[] = []
    const queue = [pid]
    while (queue.length) {
        for (const c of kids.get(queue.shift()!) ?? []) {
            found.push(c)
            queue.push(c)
        }
    }
    return found
}

const signal = (pid: number, sig: NodeJS.Signals) => {
    try {
        process.kill(pid, sig)
    } catch {}
}

/** Run an engine to completion with the widened PATH. Never throws on a non-zero exit.
 *  Aborting `stop` ends the engine and everything it started. Marker ignores SIGINT and stops
 *  llama-server (spawned in its own session) only from a Python `atexit`, which no signal reliably
 *  reaches, so the engine is frozen, its descendants listed, the engine killed, and each
 *  descendant sent SIGTERM, then SIGKILL after `STOP_GRACE_MS`. */
export async function runTool(
    bin: string,
    argv: string[],
    stop?: AbortSignal,
    env: Record<string, string> = {},
): Promise<ToolRun> {
    const proc = Bun.spawn([bin, ...argv], {
        env: { ...process.env, PATH: toolPath(), ...env },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const end = () => {
        signal(proc.pid, 'SIGSTOP')
        const helpers = descendants(proc.pid)
        signal(proc.pid, 'SIGKILL')
        for (const pid of helpers) signal(pid, 'SIGTERM')
        setTimeout(() => {
            for (const pid of helpers) signal(pid, 'SIGKILL')
        }, STOP_GRACE_MS).unref()
    }
    if (stop?.aborted) end()
    else stop?.addEventListener('abort', end, { once: true })
    try {
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        return { code, stdout, stderr }
    } finally {
        stop?.removeEventListener('abort', end)
    }
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

/** Reinstalls Marker within the 2.x line, the one that runs on llama-server. */
export const MARKER_REPAIR = "uv tool install --reinstall 'marker-pdf>=2,<3'"

/** Loaded as `sitecustomize` by every Python process Marker runs. marker-pdf 2.0.0 reads an
 *  image's box with `PdfObject.get_pos`, which the pypdfium2 5 it pins renamed `get_bounds`, so a
 *  page holding text and an image crashed the run. The alias is added only where it is missing. */
export const MARKER_SHIM = `try:
    import pypdfium2
    if not hasattr(pypdfium2.PdfObject, "get_pos") and hasattr(pypdfium2.PdfObject, "get_bounds"):
        pypdfium2.PdfObject.get_pos = pypdfium2.PdfObject.get_bounds
except Exception:
    pass
`

/** Write the shim into `dir` and return the env that puts it first on Python's path. */
export function markerShimEnv(
    dir: string,
    env: Record<string, string | undefined> = process.env,
): Record<string, string> {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'sitecustomize.py'), MARKER_SHIM)
    return { PYTHONPATH: [dir, env.PYTHONPATH].filter(Boolean).join(delimiter) }
}

/** The one-line reason a failed Marker run reports: Python's final exception line (or stderr's
 *  last line), then the command that repairs the install. A traceback tail tells a person nothing
 *  they can act on. */
export function markerFailure(code: number, stderr: string): string {
    const lines = stderr
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
    const exception = [...lines]
        .reverse()
        .find(l => /^[A-Za-z_][\w.]*(Error|Exception):/.test(l))
    const reason = exception ?? lines.at(-1) ?? `exit code ${code}`
    return /^(AttributeError|ImportError|ModuleNotFoundError):/.test(reason)
        ? `marker's install is broken (${reason}) — repair it: ${MARKER_REPAIR}`
        : `marker failed (${reason}) — if it keeps failing, reinstall it: ${MARKER_REPAIR}`
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
 *  markdown. `verb` names the caller in a missing-engine error. Aborting `signal` stops Marker
 *  and rejects with a CANCELLED error. */
export async function markerTranscribe(
    abs: string,
    opts: OcrOptions = {},
    verb = 'ocr',
    signal?: AbortSignal,
): Promise<string> {
    const bin = requireTool('marker_single', verb)
    requireTool('llama-server', verb)
    const outDir = mkdtempSync(join(tmpdir(), 'bismuth-marker-'))
    try {
        const env = markerShimEnv(join(outDir, '.shim'))
        const r = await runTool(bin, markerArgs(abs, outDir, opts), signal, env)
        if (signal?.aborted) throw createError('CANCELLED', `${verb} cancelled`)
        const md = r.code === 0 ? findMarkdown(outDir) : null
        if (!md)
            throw createError(
                'INTERNAL_ERROR',
                r.code === 0
                    ? 'marker wrote no markdown'
                    : markerFailure(r.code, r.stderr),
                500,
            )
        return await readFile(md, 'utf8')
    } finally {
        rmSync(outDir, { recursive: true, force: true })
    }
}
