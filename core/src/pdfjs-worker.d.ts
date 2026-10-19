// pdfjs-dist ships no types for its worker entry; core/src/drawing/pdfHighlightText.ts only hands
// the module to pdf.js as `globalThis.pdfjsWorker`, so its shape is opaque here.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
    export const WorkerMessageHandler: unknown
}
