// app/src/export/htmlToPdf.ts
// Renders an HTML *document* string to PDF bytes — always Letter-size pages.
//
// Fidelity strategy: the PDF must look like the in-app preview, which is just the browser
// rendering the HTML. jsPDF's own pdf.html() reflows text through a separate engine and
// looks nothing like the browser. Instead we render the HTML in an isolated off-screen
// iframe (its own document — body/<style> can't leak into the app), snapshot that real
// browser rendering with html2canvas, then slice the image across Letter pages. The result
// matches the preview (rasterized) and auto-downloads with no print dialog.
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// US Letter. jsPDF "letter" page = 612 x 792 pt; render the source at 8.5in @ 96dpi.
const PAGE_W_PX = 816; // 8.5in * 96
const PAGE_W_PT = 612;
const PAGE_H_PT = 792;

export async function htmlToPdf(html: string): Promise<Uint8Array> {
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
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    iframe.style.height = `${doc.body.scrollHeight}px`;
    // Ensure fonts are loaded so html2canvas measures text with the right metrics.
    try { await doc.fonts?.ready; } catch { /* fonts API unavailable — proceed */ }
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const bg = getComputedStyle(doc.body).backgroundColor || "#ffffff";
    const canvas = await html2canvas(doc.body, {
      scale: 2,
      backgroundColor: bg,
      width: PAGE_W_PX,
      windowWidth: PAGE_W_PX,
      useCORS: true,
    });

    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    const scale = PAGE_W_PT / canvas.width; // canvas px -> pt
    const pageHpx = Math.floor(PAGE_H_PT / scale); // source px per Letter page
    let offset = 0;
    let first = true;
    while (offset < canvas.height) {
      const sliceHpx = Math.min(pageHpx, canvas.height - offset);
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
  } finally {
    iframe.remove();
  }
}
