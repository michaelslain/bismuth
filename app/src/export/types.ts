// app/src/export/types.ts
import type { Row } from "../../../core/src/bases/types";

export type ExportFormat = "html" | "pdf" | "md" | "png";

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  filename: string;       // e.g. "note.html"
  previewHtml?: string;   // shown in an <iframe srcdoc>
  previewImg?: string;    // data: URL, shown in an <img> (drawings)
}

// Impure dependencies injected so exporters.ts stays unit-testable.
export interface ExportDeps {
  read: (path: string) => Promise<string>;
  resolveRows: (basePath: string) => Promise<Row[]>;
  htmlToPdf: (html: string) => Promise<Uint8Array>;
  drawingToPng: (docText: string) => Promise<{ bytes: Uint8Array; dataUrl: string }>;
}
