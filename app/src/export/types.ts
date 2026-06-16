// app/src/export/types.ts
import type { Row, SourceSpec } from "../../../core/src/bases/types";

export type ExportFormat = "html" | "pdf" | "md" | "png";

export type ExportTheme = "dark" | "light";

// What the export tab displays. Cheap to compute — never generates export bytes
// (in particular never runs the heavy html->pdf pipeline), so switching formats
// in the UI stays instant and side-effect-free.
export interface ExportPreview {
  previewHtml?: string;   // shown in an <iframe srcdoc> (isolated document)
  previewImg?: string;    // data: URL, shown in an <img> (drawings)
}

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  filename: string;       // e.g. "note.html"
  previewHtml?: string;
  previewImg?: string;
}

// Impure dependencies injected so exporters.ts stays unit-testable.
export interface ExportDeps {
  read: (path: string) => Promise<string>;
  resolveRows: (spec: SourceSpec) => Promise<Row[]>;
  htmlToPdf: (html: string) => Promise<Uint8Array>;
  htmlToPng: (html: string) => Promise<{ bytes: Uint8Array; dataUrl: string }>;
  drawingToPng: (docText: string, theme: ExportTheme) => Promise<{ bytes: Uint8Array; dataUrl: string }>;
}
