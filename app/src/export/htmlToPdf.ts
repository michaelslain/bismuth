// app/src/export/htmlToPdf.ts
// Renders an HTML *document* string to PDF bytes using jsPDF's html() pipeline.
// Runs in the webview (Tauri) and the browser dev preview alike — no system print dialog.
//
// The source is written into an isolated, off-screen <iframe> rather than a <div> in the
// host document. A full document's `<style>`/`body{}` rules apply to whatever document they
// live in, so injecting them into the app's DOM would restyle (and visibly break) the app
// while the PDF renders. An iframe gives the source its own document — zero leakage.
import { jsPDF } from "jspdf";

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:760px;height:1200px;border:0;";
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    // Let the iframe document lay out before jsPDF measures it.
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    await pdf.html(doc.body, {
      autoPaging: "text",
      margin: [24, 24, 24, 24],
      width: 547, // a4 content width in pt (595 - 2*24)
      windowWidth: 760,
    });
    return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
  } finally {
    iframe.remove();
  }
}
