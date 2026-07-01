// app/src/drawing/pdfRaster.ts
// Client-side PDF rasterizer: turns a PDF's bytes into one image data-URL per page, so the
// drawing-markup layer can carry each PDF page as a full-page background image. Rasterizing
// happens ONLY in the browser (pdfjs-dist) — core's headless `.draw` export never touches
// pdfjs and keeps working on the resulting self-contained `data:` URLs.
//
// pdfjs-dist v6 ships ESM; its worker is a sibling `.mjs`. We pull the worker through a Vite
// `?url` import so it stays a separate emitted asset (a real Worker needs a URL, not an inlined
// module), and `manualChunks` keeps the pdfjs code off the boot bundle (see vite.config.ts).
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pushToast } from "../Toast";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RasterizeOpts {
  /** Target raster width in px for a page (the markup page is 816 wide, so ~2× gives crisp
   *  zoom headroom). Default 1600. */
  targetWidth?: number;
  /** Hard cap on either raster dimension so a poster-size / rotated page can't exhaust canvas
   *  memory. Default 4000. */
  maxDim?: number;
  /** JPEG quality (JPEG keeps the sidecar far smaller than a fat PNG data-URL). Default 0.85. */
  quality?: number;
  /** Hard cap on pages rasterized — each page embeds a base64 JPEG in the `.draw` JSON, so an
   *  unbounded page count could produce a multi-hundred-MB sidecar and exhaust memory. Default 100;
   *  pages beyond the cap are dropped with a toast. */
  maxPages?: number;
}

const DEFAULTS: Required<RasterizeOpts> = { targetWidth: 1600, maxDim: 4000, quality: 0.85, maxPages: 100 };

/** Rasterize every page of a PDF to an image data-URL (JPEG q~0.85), one per page in order.
 *  A single page that fails to render is skipped (with a toast) rather than aborting the whole
 *  document; only a PDF that can't be opened at all throws. */
export async function rasterizePdf(bytes: ArrayBuffer, opts?: RasterizeOpts): Promise<string[]> {
  const { targetWidth, maxDim, quality, maxPages } = { ...DEFAULTS, ...opts };
  // getDocument transfers the buffer to the worker (detaching it); hand it a fresh copy so a
  // caller still holding `bytes` isn't left with a detached ArrayBuffer.
  const data = new Uint8Array(bytes.slice(0));
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const urls: string[] = [];
  const lastPage = Math.min(pdf.numPages, maxPages);
  if (pdf.numPages > maxPages) {
    pushToast(`PDF has ${pdf.numPages} pages — only the first ${maxPages} are opened for markup.`);
  }
  try {
    for (let n = 1; n <= lastPage; n++) {
      try {
        urls.push(await renderPage(pdf, n, targetWidth, maxDim, quality));
      } catch (e) {
        pushToast(`Couldn't render PDF page ${n}: ${(e as Error).message}`);
      }
    }
  } finally {
    // Abort the worker + free its page/font caches once we've captured the rasters (destroy()
    // lives on the loading task in pdfjs v6, not the document proxy).
    void loadingTask.destroy();
  }
  return urls;
}

async function renderPage(
  pdf: pdfjs.PDFDocumentProxy,
  pageNum: number,
  targetWidth: number,
  maxDim: number,
  quality: number,
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  // Scale up so the raster is ~targetWidth wide (crispness headroom for zoom), then clamp so
  // neither dimension exceeds maxDim. Never scale below 1 (a tiny page still wants some detail).
  const wanted = targetWidth / base.width;
  const capped = maxDim / Math.max(base.width, base.height);
  const scale = Math.max(1, Math.min(wanted, capped));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context");
  // A PDF page can be transparent; paint white first so JPEG (no alpha) doesn't come out black
  // and the raster matches how a PDF viewer shows the page.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // v6 render prefers `canvas` over the legacy `canvasContext`; pdfjs derives the context itself.
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas.toDataURL("image/jpeg", quality);
}
