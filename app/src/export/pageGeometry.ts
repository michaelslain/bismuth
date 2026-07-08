// app/src/export/pageGeometry.ts
// Pure geometry for the browser PDF exporter (htmlToPdf.ts).
//
// The exported PDF is US Letter portrait (8.5in x 11in) with a 1 inch margin on every side —
// equivalent to the CSS `@page { size: 8.5in 11in; margin: 1in; }` a browser-print path would
// use, but computed explicitly here because htmlToPdf rasterizes the document with html2canvas
// and slices that single canvas across pages itself (html2canvas ignores @page rules).
//
// Units: PDF points at 72pt/in. Letter = 612 x 792 pt; a 1in margin = 72pt; so the printable
// (content) box is 468 x 648 pt. The source HTML is rasterized at 8.5in @ 96dpi (816px wide)
// and the resulting canvas is mapped edge-to-edge into the printable box.
//
// The pure parts (page constants + px->pt slice scale + an rgb() parser used to paint the page
// background into the 1in margin band) are unit-tested in pageGeometry.test.ts.

/** US Letter portrait, in PDF points (72pt/in): 8.5in x 11in. */
export const PAGE_W_PT = 612; // 8.5 * 72
export const PAGE_H_PT = 792; // 11 * 72

/** 1 inch margin on every side. */
export const MARGIN_PT = 72; // 1 * 72

/** Printable content box = Letter minus a 1in margin on each edge. */
export const CONTENT_W_PT = PAGE_W_PT - 2 * MARGIN_PT; // 468
export const CONTENT_H_PT = PAGE_H_PT - 2 * MARGIN_PT; // 648

/** Source raster width: 8.5in @ 96dpi. The iframe body is laid out at this width. */
export const PAGE_W_PX = 816; // 8.5 * 96

/**
 * Map a rasterized canvas (whose width fills the printable box) onto Letter pages:
 *   - `scale` converts source canvas px -> PDF pt inside the 1in margins.
 *   - `pageHpx` is how many source px of height fill ONE printable page (the vertical slice
 *     height the pager cuts at, before honoring any earlier forced page-break marker).
 * Pure so the pager's math is unit-tested without a DOM.
 */
export function pdfSliceMetrics(canvasWidthPx: number): { scale: number; pageHpx: number } {
  const scale = CONTENT_W_PT / canvasWidthPx; // canvas px -> pt within the printable box
  const pageHpx = Math.floor(CONTENT_H_PT / scale); // source px per printable page
  return { scale, pageHpx };
}

/**
 * Parse an html2canvas-safe color string (`rgb()`/`rgba()`/`#rgb`/`#rrggbb`) to `[r,g,b]`
 * 0..255 for jsPDF's numeric `setFillColor`. Alpha is ignored (the PDF page fill is opaque).
 * Anything unrecognized falls back to white so a page is never painted an unexpected color.
 * (Input is already normalized to rgb()/hex by cssColor.normalizeCssColor before reaching here.)
 */
export function parseRgbColor(color: string): [number, number, number] {
  const v = color.trim();
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(v);
  if (rgb) {
    return [clamp255(rgb[1]), clamp255(rgb[2]), clamp255(rgb[3])];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [255, 255, 255];
}

function clamp255(n: string): number {
  return Math.max(0, Math.min(255, Math.round(parseFloat(n))));
}
