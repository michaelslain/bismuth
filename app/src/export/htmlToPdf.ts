// app/src/export/htmlToPdf.ts
// Renders an HTML *document* string to PDF or PNG bytes.
//
// Fidelity strategy: the output must look like the in-app preview, which is just the browser
// rendering the HTML. jsPDF's own pdf.html() reflows text through a separate engine and
// looks nothing like the browser. Instead we render the HTML in an isolated off-screen
// iframe (its own document — body/<style> can't leak into the app), snapshot that real
// browser rendering with html2canvas, then (for PDF) slice the image across Letter pages.
// The iframe document is fully self-contained, so embedded KaTeX CSS+fonts (data: URIs, via
// exporters.ts) are what make exported math render — the iframe can't see the app's fonts.
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// US Letter. jsPDF "letter" page = 612 x 792 pt; render the source at 8.5in @ 96dpi.
const PAGE_W_PX = 816; // 8.5in * 96
const PAGE_W_PT = 612;
const PAGE_H_PT = 792;

// Let the off-screen iframe lay out before measuring/snapshotting. Uses setTimeout, NOT
// requestAnimationFrame: rAF is throttled to zero in a hidden/backgrounded tab, so an
// export started (or left running) while the window isn't foreground would hang forever
// waiting for a frame that never comes. A fixed delay always fires.
const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Render an HTML document string to a single full-content canvas via an off-screen iframe.
 * Shared by the PDF (sliced into pages) and PNG (single image) exporters. The caller's
 * document MUST be self-contained — the iframe inherits nothing from the app, and
 * `doc.fonts.ready` here is what gates the snapshot on embedded @font-face fonts (incl.
 * the inlined KaTeX glyph fonts) so math is measured/drawn correctly.
 */
async function htmlToCanvas(html: string): Promise<{ canvas: HTMLCanvasElement; bg: string; breaks: number[] }> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W_PX}px;height:200px;border:0;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    // Let the iframe document lay out, then grow the frame to the full content height so
    // html2canvas captures everything (not just the initial viewport).
    await settle();
    iframe.style.height = `${doc.body.scrollHeight}px`;
    // Ensure fonts are loaded so html2canvas measures text with the right metrics. With
    // inlined KaTeX fonts (data: URIs) this resolves once the math glyph fonts are ready.
    // Race a cap so a never-resolving fonts.ready (some embedded-font edge cases) can't hang.
    try { await Promise.race([doc.fonts?.ready, settle(4000)]); } catch { /* proceed */ }
    await settle();

    const bg = getComputedStyle(doc.body).backgroundColor || "#ffffff";
    // Browsers cap a canvas at ~32767px per side. At the default 2x scale that's ~16k source
    // px (~17 Letter pages); a taller doc makes html2canvas silently return a blank/clamped
    // canvas. Drop the scale so the scaled height stays under the cap (lower-res but valid)
    // — matters most for PNG, which is one image with no page slicing.
    const MAX_CANVAS_PX = 32000;
    const scale = Math.max(1, Math.min(2, Math.floor(MAX_CANVAS_PX / Math.max(1, doc.body.scrollHeight))));
    // Explicit page-break markers (bases/markdown.ts `<div class="bismuth-page-break">`): their
    // post-layout Y offset, scaled into canvas pixels. The PDF slicer cuts a new page at each.
    // Measured here (after layout has settled) while the iframe doc is still live. A marker before
    // the first content (offsetTop ≈ body padding-top) or after the last (≈ content bottom) would
    // slice off an empty page, so ignore markers outside the real content band.
    const padCs = getComputedStyle(doc.body);
    const padTop = parseFloat(padCs.paddingTop) || 0;
    const contentBottom = doc.body.scrollHeight - (parseFloat(padCs.paddingBottom) || 0);
    const breaks = Array.from(doc.querySelectorAll<HTMLElement>(".bismuth-page-break"))
      .map((el) => el.offsetTop)
      .filter((y) => y > padTop + 1 && y < contentBottom - 1)
      .map((y) => Math.round(y * scale))
      .sort((a, b) => a - b);
    const canvas = await html2canvas(doc.body, {
      scale,
      backgroundColor: bg,
      width: PAGE_W_PX,
      windowWidth: PAGE_W_PX,
      useCORS: true,
    });
    if (canvas.height === 0) throw new Error("htmlToCanvas: nothing to render");
    return { canvas, bg, breaks };
  } finally {
    iframe.remove();
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Rasterize a self-contained HTML document to a single PNG (bytes + a data: URL preview). */
export async function htmlToPng(html: string): Promise<{ bytes: Uint8Array; dataUrl: string }> {
  const { canvas } = await htmlToCanvas(html);
  const dataUrl = canvas.toDataURL("image/png");
  return { bytes: dataUrlToBytes(dataUrl), dataUrl };
}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const { canvas, bg, breaks } = await htmlToCanvas(html);
  {
    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    const scale = PAGE_W_PT / canvas.width; // canvas px -> pt
    const pageHpx = Math.floor(PAGE_H_PT / scale); // source px per Letter page
    let offset = 0;
    let first = true;
    let bi = 0; // cursor into the sorted page-break offsets
    while (offset < canvas.height) {
      // A forced page break that falls inside this page ends it early (the next slice starts AT
      // the marker); otherwise cut at the natural full-page bottom. Skip markers at/above the
      // current offset so a marker exactly on a page boundary never emits an empty page.
      while (bi < breaks.length && breaks[bi] <= offset) bi++;
      let sliceEnd = offset + pageHpx;
      if (bi < breaks.length && breaks[bi] < sliceEnd) {
        sliceEnd = breaks[bi];
        bi++;
      }
      const sliceHpx = Math.min(sliceEnd, canvas.height) - offset;
      // Full-page slice padded with the document background so partial last pages stay
      // on-theme (e.g. a dark page is fully dark, not white below the content).
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = pageHpx;
      const ctx = slice.getContext("2d")!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, offset, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);

      if (!first) pdf.addPage("letter");
      // JPEG (opaque — slices are bg-filled) keeps a multi-page doc to a few hundred KB;
      // PNG of a full-page 2x raster runs to ~10MB/page. 0.92 is visually lossless at doc zoom.
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, PAGE_W_PT, PAGE_H_PT);
      offset += sliceHpx;
      first = false;
    }
    return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
  }
}
