// app/src/export/formats.ts
import type { ExportFormat, RenderMode } from './types'
import { SETTINGS_FILE } from '../tabIds'
import { baseNameOf, isBasePath } from '../../../core/src/bases/baseFile'

// Defined here (the pure leaf), not in ./exporters, and re-used by exporters.ts.
// exporters.ts statically pulls in `marked` (../bases/markdown) + jspdf, and App.tsx
// imports `isExportable` from here for render-time gating — importing exporters here
// would drag that whole export stack toward the entry bundle. `ext` is trivial + pure.
export function ext(path: string): string {
    const dot = path.lastIndexOf('.')
    return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

// A base is a `type: base` md file, so it falls under `md` (same formats) — there is
// no separate `base` extension.
const MATRIX: Record<string, ExportFormat[]> = {
    md: ['pdf', 'html', 'png', 'md'],
    sheet: ['pdf', 'html', 'png'],
    draw: ['pdf', 'png'],
}

/** Formats valid for a path's file type, in display order. Empty if not exportable. */
export function formatsFor(path: string): ExportFormat[] {
    if (path.startsWith('::')) return []
    if (path === SETTINGS_FILE) return [] // settings is config, not a document
    // A `.base.jsonl` is a base: same formats as a markdown base (the extension is `jsonl`).
    if (isBasePath(path)) return MATRIX.md
    return MATRIX[ext(path)] ?? []
}

/** The format the export pane starts on: `pdf` wherever it is offered, else the first. */
export function defaultFormat(formats: ExportFormat[]): ExportFormat {
    return formats.includes('pdf') ? 'pdf' : (formats[0] ?? 'pdf')
}

/** The output file's name without its extension: a base's own name, else the file's stem. */
export function stemName(path: string): string {
    if (isBasePath(path)) return baseNameOf(path)
    const file = path.split('/').pop() ?? path
    const dot = file.lastIndexOf('.')
    return dot === -1 ? file : file.slice(0, dot)
}

/** Every filename an export writes: one `<stem>.<format>`, except a PNG of a note split by page
 *  breaks, which writes one `<stem>-<n>.png` per page. The exporter and the pane's summary line
 *  both name files through this, so the pane never promises a name the export does not write. */
export function exportFilenames(
    path: string,
    format: ExportFormat,
    pngPages = 1,
): string[] {
    const name = stemName(path)
    if (format === 'png' && pngPages > 1)
        return Array.from({ length: pngPages }, (_, i) => `${name}-${i + 1}.png`)
    return [`${name}.${format}`]
}

export function isExportable(path: string): boolean {
    return formatsFor(path).length > 0
}

// Options-aware format list for the export UI. `formatsFor` is extension-keyed and can't
// see file contents, so a base (a `.md`) needs this contents-aware refinement:
//  - non-base: unchanged (the extension matrix).
//  - base + "data": the flat-table forms (md + csv added — both only meaningful as data).
//  - base + "visual": only the rendered forms (html/pdf/png); md/csv have no sensible
//    form for a calendar grid / kanban board.
export function formatsForOptions(
    path: string,
    isBase: boolean,
    mode: RenderMode,
): ExportFormat[] {
    if (!isBase) return formatsFor(path)
    return mode === 'data'
        ? ['pdf', 'html', 'png', 'md', 'csv']
        : ['pdf', 'html', 'png']
}
