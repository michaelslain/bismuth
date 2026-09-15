// app/src/preview/pdfViewMemory.ts
// Remembers each PDF's zoom, bookmarks-panel-open state and scroll position so switching tabs
// away from a PDF and back doesn't drop the reader back at fit-width, panel-closed, page one.
//
// In-memory (per session) by design, same ruling as `scrollMemory.ts`: reopening tabs across a
// full reload is a separate concern from tab switching, and the PDF's zoom is already a
// transient, non-`.settings` value (PreviewView's own comment on `pdfZoom`).
import type { PdfPosition } from './annotationTypes'

export type PdfViewState = {
    position?: PdfPosition
    zoom: number
    panelOpen: boolean
}

const viewByPath = new Map<string, PdfViewState>()

/** The remembered view state for a PDF, or undefined if none. */
export function loadPdfView(path: string): PdfViewState | undefined {
    return viewByPath.get(path)
}

/** Merge `patch` into the remembered state for `path`, creating `{ zoom: 1, panelOpen: false }`
 *  first if nothing was stored yet. */
export function savePdfView(path: string, patch: Partial<PdfViewState>): void {
    const current = viewByPath.get(path) ?? { zoom: 1, panelOpen: false }
    viewByPath.set(path, { ...current, ...patch })
}

/** Forget a PDF's view state (e.g. on delete). */
export function clearPdfView(path: string): void {
    viewByPath.delete(path)
}

/** Re-key a remembered view state across a rename/move, so the renamed file keeps its zoom,
 *  panel and position instead of resetting. No-op when nothing was stored for `from`. */
export function renamePdfView(from: string, to: string): void {
    const v = viewByPath.get(from)
    if (v === undefined) return
    viewByPath.delete(from)
    viewByPath.set(to, v)
}

// Keep a PDF's view state attached across a rename/move, and forget it on delete — the same
// `bismuth-moved`/`bismuth-deleted` idiom `scrollMemory.ts` listens for.
if (typeof window !== 'undefined') {
    window.addEventListener('bismuth-moved', e => {
        const { from, to } = (e as CustomEvent).detail as {
            from: string
            to: string
        }
        renamePdfView(from, to)
    })
    window.addEventListener('bismuth-deleted', e => {
        const path = (e as CustomEvent).detail as string
        clearPdfView(path)
    })
}
