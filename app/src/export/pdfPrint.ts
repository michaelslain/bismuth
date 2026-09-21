// app/src/export/pdfPrint.ts
// The PDF engine chooser + fallback: pick WebKit (native, inside the desktop app) or canvas
// (html2canvas + jsPDF, everywhere else), and run whichever was picked with a safety net — a
// failing WebKit print falls back to canvas rather than losing the export outright.
import { injectHead, WEBKIT_PRINT_HEAD } from './printCss'
import { isTauri } from '../nativeMenu'

export type PdfEngine = 'webkit' | 'canvas'

/** 'webkit' inside a Tauri webview (the native command decides platform support itself and
 *  answers "unsupported" where it cannot print), 'canvas' everywhere else. Pure. */
export function pickPdfEngine(env: { tauri: boolean }): PdfEngine {
    return env.tauri ? 'webkit' : 'canvas'
}

export interface PdfPrinters {
    webkit: (html: string, title: string) => Promise<Uint8Array>
    canvas: (html: string) => Promise<Uint8Array>
}

/** Runs the chosen engine; a failing webkit print falls back to canvas. `warn` is called once with
 *  the failure message unless it is exactly 'unsupported' (an expected answer on iPad). Pure over
 *  its arguments. */
export async function printPdf(
    html: string,
    title: string,
    engine: PdfEngine,
    printers: PdfPrinters,
    warn?: (msg: string) => void,
): Promise<Uint8Array> {
    if (engine === 'canvas') return printers.canvas(html)
    try {
        return await printers.webkit(html, title)
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (message !== 'unsupported') warn?.(message)
        return printers.canvas(html)
    }
}

/** The real webkit printer: invokes the `print_pdf` Tauri command with the print head injected,
 *  via an injectable `invoke` seam so tests can stub the Tauri bridge without a real webview. */
export function makeWebkitPrinter(
    invoke: (cmd: string, args: Record<string, unknown>) => Promise<ArrayBuffer>,
): (html: string, title: string) => Promise<Uint8Array> {
    return async (html, title) => {
        const buf = await invoke('print_pdf', {
            html: injectHead(html, WEBKIT_PRINT_HEAD),
            title,
        })
        return new Uint8Array(buf)
    }
}

/** The real printers: webkit prints natively through the `print_pdf` Tauri command (dynamic
 *  import of '@tauri-apps/api/core' so the Tauri bridge never lands in a non-desktop bundle);
 *  canvas defers to the html2canvas/jsPDF fallback, kept in its own lazy chunk. */
export const realPrinters: PdfPrinters = {
    webkit: async (html, title) => {
        const { invoke } = await import('@tauri-apps/api/core')
        return makeWebkitPrinter(invoke as any)(html, title)
    },
    canvas: async html => (await import('./htmlToPdf')).htmlToPdf(html),
}

/** What ExportView wires into ExportDeps.htmlToPdf. */
export function htmlToPdfBytes(html: string, title: string): Promise<Uint8Array> {
    return printPdf(
        html,
        title,
        pickPdfEngine({ tauri: isTauri() }),
        realPrinters,
        msg => console.warn('webkit pdf print failed, falling back to canvas:', msg),
    )
}
