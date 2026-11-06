// OCR for vault PDFs, behind `bismuth ocr` (cli/src/commands/ocr.ts):
//
//  - ocrmypdf (tesseract underneath) puts an invisible, selectable text layer into a PDF, in place.
//    It runs with `--redo-ocr`, never `--skip-text`: a scanned page whose only real text is a
//    publisher watermark ("Downloaded from Wiley Online Library…" running up the margin) counts as
//    "has text" to `--skip-text`, which then skips the whole page, so the body stays unselectable.
//    `--redo-ocr` keeps vector text where it is and OCRs everything else, and does not rasterise
//    the page, so the file stays near its original size. `--force-ocr` (our `--force`) rasterises
//    every page and is the escape hatch for a PDF whose existing text layer is garbage.
//
// Page parsing and the engine lookup live in core/src/marker.ts, re-exported here. Everything here is
// pure, so the argv shapes are unit-tested without ocrmypdf installed.
import type { OcrOptions } from '../../core/src/marker'

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
