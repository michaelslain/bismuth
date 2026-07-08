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
import { sanitizeDocColorsForRaster, normalizeCssColor } from "./cssColor";
import {
  PAGE_W_PX,
  PAGE_W_PT,
  PAGE_H_PT,
  MARGIN_PT,
  CONTENT_W_PT,
  CONTENT_H_PT,
  pdfSliceMetrics,
  parseRgbColor,
} from "./pageGeometry";

// US Letter portrait with a 1in margin on every side — geometry lives in pageGeometry.ts
// (jsPDF "letter" page = 612 x 792 pt; source rasterized at 8.5in @ 96dpi = 816px wide).

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
async function htmlToCanvas(
  html: string,
  bodyOverrideCss = "",
): Promise<{ canvas: HTMLCanvasElement; bg: string; breaks: number[] }> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W_PX}px;height:200px;border:0;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    // For the paged PDF path: neutralize the shared template's reading-column gutter (its
    // max-width + body padding) so the content fills the raster width and maps edge-to-edge
    // into the printable box — the 1in whitespace then comes solely from the PDF page margin,
    // making it exactly 1in on every side rather than 1in plus the on-screen gutter. Injected
    // last so it wins the cascade. No-op ("") for the PNG path, which keeps the reading column.
    if (bodyOverrideCss) {
      const style = doc.createElement("style");
      style.textContent = bodyOverrideCss;
      doc.head.appendChild(style);
    }
    // Let the iframe document lay out, then grow the frame to the full content height so
    // html2canvas captures everything (not just the initial viewport).
    await settle();
    iframe.style.height = `${doc.body.scrollHeight}px`;
    // Ensure fonts are loaded so html2canvas measures text with the right metrics. With
    // inlined KaTeX fonts (data: URIs) this resolves once the math glyph fonts are ready.
    // Race a cap so a never-resolving fonts.ready (some embedded-font edge cases) can't hang.
    try { await Promise.race([doc.fonts?.ready, settle(4000)]); } catch { /* proceed */ }
    await settle();

    // Defense-in-depth against html2canvas's color parser: it throws on any CSS Color 4
    // function ("Attempting to parse an unsupported color function 'color'"). The palette is
    // normalized at read time (resolvePalette), but KaTeX/view/extra CSS could still compute
    // to color(srgb …) — inline a normalized rgb() over every unsafe computed color before
    // snapshotting. No-op (0 rewrites) for a clean document.
    sanitizeDocColorsForRaster(doc);

    // The body background feeds html2canvas + the PDF page fill directly, so normalize it too.
    const bg = normalizeCssColor(getComputedStyle(doc.body).backgroundColor || "#ffffff", "#ffffff");
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

// Fill the raster edge-to-edge into the printable box: drop the shared template's reading
// column (max-width + body padding) so the ONLY margin is the 1in page margin below.
const PDF_BODY_OVERRIDE =
  `html,body{margin:0!important;padding:0!important;max-width:none!important;width:100%!important;}` +
  // The first block's intrinsic top margin (e.g. an <h1>'s margin-top) would otherwise stack on
  // top of the 1in page margin; zero it so content begins exactly at the 1in boundary.
  `body>:first-child{margin-top:0!important;}`;

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const { canvas, bg, breaks } = await htmlToCanvas(html, PDF_BODY_OVERRIDE);
  {
    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    const [r, g, b] = parseRgbColor(bg);
    // The raster maps into the printable box (Letter minus 1in on each edge), not the whole page.
    const { pageHpx } = pdfSliceMetrics(canvas.width); // source px per printable page (inside the margins)
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
      // Full-page-height slice padded with the document background so partial pages stay
      // on-theme (e.g. a dark page is fully dark, not white below the content).
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = pageHpx;
      const ctx = slice.getContext("2d")!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, offset, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);

      if (!first) pdf.addPage("letter");
      // Paint the whole page (including the 1in margin band) with the document background so the
      // margin stays on-theme, then place the content raster inside the 1in margins.
      pdf.setFillColor(r, g, b);
      pdf.rect(0, 0, PAGE_W_PT, PAGE_H_PT, "F");
      // JPEG (opaque — slices are bg-filled) keeps a multi-page doc to a few hundred KB;
      // PNG of a full-page 2x raster runs to ~10MB/page. 0.92 is visually lossless at doc zoom.
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN_PT, MARGIN_PT, CONTENT_W_PT, CONTENT_H_PT);
      offset += sliceHpx;
      first = false;
    }
    return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
  }
}
