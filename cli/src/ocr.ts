// OCR for vault PDFs and images, behind `bismuth ocr` (cli/src/commands/ocr.ts) and the MCP `ocr`
// tool. Two external engines do the work:
//
//  - ocrmypdf (tesseract underneath) puts an invisible, selectable text layer into a PDF, in place.
//    It runs with `--redo-ocr`, never `--skip-text`: a scanned page whose only real text is a
//    publisher watermark ("Downloaded from Wiley Online Library…" running up the margin) counts as
//    "has text" to `--skip-text`, which then skips the whole page, so the body stays unselectable.
//    `--redo-ocr` keeps vector text where it is and OCRs everything else, and does not rasterise
//    the page, so the file stays near its original size. `--force-ocr` (our `--force`) rasterises
//    every page and is the escape hatch for a PDF whose existing text layer is garbage.
//  - Marker (marker-pdf, run through llama.cpp's llama-server) transcribes a PDF or image to
//    markdown with math as `$…$` / `$$…$$` LaTeX. That transcription lands in a sibling note.
//
// Everything here except `runTool`/`findTool` is pure, so the argv and note shapes are unit-tested
// without either engine installed.
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { extOfPath, isPdfPath } from '../../core/src/fileKinds'

/** Image kinds both engines read. A subset of fileKinds' IMAGE_EXTS: svg, ico, gif, avif and heic
 *  are left out because tesseract and Marker's image loader do not take them. */
export const OCR_IMAGE_EXTS: ReadonlySet<string> = new Set([
    'png',
    'jpg',
    'jpeg',
    'tif',
    'tiff',
    'webp',
    'bmp',
])

export function isOcrImagePath(path: string): boolean {
    return OCR_IMAGE_EXTS.has(extOfPath(path))
}

export function isOcrablePath(path: string): boolean {
    return isPdfPath(path) || isOcrImagePath(path)
}

/** The sibling note a transcription is written to: `dir/paper.pdf` → `dir/paper.ocr.md`. */
export function ocrNotePath(file: string): string {
    const slash = file.lastIndexOf('/')
    const dir = slash === -1 ? '' : file.slice(0, slash + 1)
    const base = file.slice(slash + 1)
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    return `${dir}${stem}.ocr.md`
}

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

/** ocrmypdf counts pages from 1, the same as the user's spec. */
export function ocrmypdfPages(ranges: [number, number][]): string {
    return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')
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

/** The ocrmypdf argv that writes `output` as `input` with a text layer. `--output-type pdf` keeps
 *  the file a plain PDF: the default PDF/A conversion re-encodes it through Ghostscript. */
export function ocrmypdfArgs(
    input: string,
    output: string,
    opts: OcrOptions = {},
): string[] {
    const argv = [opts.force ? '--force-ocr' : '--redo-ocr', '--output-type', 'pdf']
    if (opts.lang) argv.push('-l', opts.lang)
    if (opts.pages) argv.push('--pages', ocrmypdfPages(opts.pages))
    argv.push(input, output)
    return argv
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

/** The tesseract argv that prints an image's text to stdout. */
export function tesseractArgs(input: string, opts: OcrOptions = {}): string[] {
    const argv = [input, 'stdout']
    if (opts.lang) argv.push('-l', opts.lang)
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
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** The note body for a transcription of `sourceName` (a basename): a `source` link back to the
 *  file, then the markdown. */
export function ocrNote(body: string, sourceName: string): string {
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
