// app/src/export/htmlToPdf.ts
// Renders an HTML document string to PDF bytes using jsPDF's html() pipeline.
// Runs in the webview (Tauri) and the browser dev preview alike — no system print dialog.
import { jsPDF } from "jspdf";

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  // Render the HTML in a detached, on-screen-but-hidden container so layout resolves.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:760px;background:#fff;";
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    await pdf.html(host, {
      autoPaging: "text",
      margin: [24, 24, 24, 24],
      width: 547,            // a4 content width in pt (595 - 2*24)
      windowWidth: 760,
    });
    return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
  } finally {
    host.remove();
  }
}
