// app/src/preview/pdfjsSetup.ts
// pdfjs-dist + its worker URL, set up as STATIC imports, isolated in their own module so PdfPages.tsx can pull the whole thing in via one
// dynamic `import('./pdfjsSetup')` instead of importing pdfjs-dist directly.
//
// WHY THIS INDIRECTION, NOT A DYNAMIC IMPORT OF THE WORKER ITSELF: a dynamic
// `import('pdfjs-dist/build/pdf.worker.min.mjs?url')` does NOT reliably resolve through Vite's
// `?url` asset handling — measured directly (a headless-Chrome probe against this story), it
// returned the worker's own executed module (its `WorkerMessageHandler` export) rather than a
// URL string, which then fails inside pdfjs with "Invalid `workerSrc` type." Vite's `?url`
// rewrite is reliable on a STATIC import (the shape the retired drawing/pdfRaster.ts used), so that's what
// this module does; PdfPages.tsx dynamically imports THIS small module instead, which still
// keeps the `pdfjs` manual chunk (vite.config.ts) off the boot bundle — pdfjs-dist is only
// loaded once something actually calls this.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }

let worker: InstanceType<typeof pdfjs.PDFWorker> | undefined

/** ONE pdf.js worker for the session. Passed to every getDocument, so opening a PDF no longer
 *  spawns a Worker, and destroying a document (cache eviction) leaves the worker running. */
export function sharedWorker() {
    worker ??= new pdfjs.PDFWorker()
    return worker
}
