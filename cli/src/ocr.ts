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
//    Marker and the engine lookup live in core/src/marker.ts, re-exported here.
//
// Everything here is pure, so the argv and note shapes are unit-tested
// without either engine installed.
import { extOfPath, isPdfPath } from '../../core/src/fileKinds'
import { sourcedNote, type OcrOptions } from '../../core/src/marker'

// Marker, page parsing and engine lookup are shared with PDF → markdown, so they live in core.
export {
    INSTALL_HINTS,
    extraToolDirs,
    findTool,
    markerArgs,
    markerPages,
    parsePages,
    runTool,
    stderrTail,
    tidyMarkdown,
    toolPath,
    type OcrOptions,
    type ToolRun,
} from '../../core/src/marker'

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

/** ocrmypdf counts pages from 1, the same as the user's spec. */
export function ocrmypdfPages(ranges: [number, number][]): string {
    return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')
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

/** The tesseract argv that prints an image's text to stdout. */
export function tesseractArgs(input: string, opts: OcrOptions = {}): string[] {
    const argv = [input, 'stdout']
    if (opts.lang) argv.push('-l', opts.lang)
    return argv
}

/** The note body for a transcription of `sourceName` (a basename): a `source` link back to the
 *  file, then the markdown. */
export function ocrNote(body: string, sourceName: string): string {
    return sourcedNote(body, sourceName)
}
