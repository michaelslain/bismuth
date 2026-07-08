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

/** Source raster width: 8.5in @ 96dpi. The iframe body is laid out at this width (PNG path). */
export const PAGE_W_PX = 816; // 8.5 * 96

/**
 * PDF content raster width: the 6.5in PRINTABLE box @ 96dpi. The PDF path lays the body out at
 * this width (not the full 8.5in page) so the raster maps edge-to-edge into the printable box
 * with NO squeeze — 96 source px == 72 PDF pt == 1 inch. That 1:1 inch mapping is what makes a
 * chosen font size (pt) render at its true point size in the PDF, and keeps every margin exactly
 * 1in. (The PNG path still lays out at the full PAGE_W_PX with the reading column.)
 */
export const CONTENT_W_PX = 624; // 6.5 * 96

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

/** One page's slice of the source content raster: a [start, start+height) band of canvas px. */
export interface PageSlice {
  /** Source-canvas Y (px) where this page's content starts. */
  start: number;
  /** Source-canvas height (px) of this page's content (< pageHpx for the last / a forced-break page). */
  height: number;
}

/**
 * Slice a rasterized content canvas of total height `contentHpx` into page-sized bands, each
 * at most `pageHpx` tall (one printable page). This is what makes a PDF **auto-paginate**:
 * content taller than one page overflows onto page 2, 3, … even with NO explicit page-break
 * markers. Each entry in `breaks` (source-px Y offsets of forced `.bismuth-page-break` markers,
 * already scaled into canvas px) ends its page early — the next band starts exactly at the
 * marker. Mirrors the natural-vs-forced cut the pager used to inline in htmlToPdf.ts.
 *
 * Pure (no DOM) so the pagination math is unit-tested in pageGeometry.test.ts.
 */
export function pageSlices(contentHpx: number, pageHpx: number, breaks: number[] = []): PageSlice[] {
  const out: PageSlice[] = [];
  if (contentHpx <= 0 || pageHpx <= 0) return out;
  const sorted = [...breaks].sort((a, b) => a - b);
  let offset = 0;
  let bi = 0; // cursor into the sorted forced-break offsets
  while (offset < contentHpx) {
    // Skip markers at/above the current offset so a marker on a page boundary never emits an
    // empty page.
    while (bi < sorted.length && sorted[bi] <= offset) bi++;
    let end = offset + pageHpx; // natural full-page bottom
    if (bi < sorted.length && sorted[bi] < end) {
      // A forced break inside this page ends it early; the next band starts AT the marker.
      end = sorted[bi];
      bi++;
    }
    end = Math.min(end, contentHpx);
    out.push({ start: offset, height: end - offset });
    offset = end;
  }
  return out;
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
