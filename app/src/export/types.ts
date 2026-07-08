// app/src/export/types.ts
import type { Row, SourceSpec } from "../../../core/src/bases/types";

export type ExportFormat = "html" | "pdf" | "md" | "png" | "csv";

export type ExportTheme = "dark" | "light";

// How a `type: base` md file is exported. "data" = the chosen view's flat table
// (markdown/csv/html table — the historical behavior); "visual" = the view rendered
// AS ITS KIND (calendar grid / cards / kanban / list). Ignored for non-base files
// (prose md / sheet / draw always behave as before).
export type RenderMode = "visual" | "data";

// Calendar visual-export span (mirrors the live calendar's ViewType).
export type CalSpan = "month" | "week" | "3day" | "day";

export type PaletteToken = "accent" | "teal" | "blue" | "violet" | "green" | "gold" | "rose";

// Concrete (already-resolved) theme values the export inlines so it matches the live app.
// Built in the browser from the app's runtime CSS vars (which settingsCssVars projects from
// the active theme + settings); the export doc can't reference var()/color-mix, so every
// value here is a literal color/font. Headless callers (CLI) fall back to DEFAULT_PALETTE.
export interface ThemePalette {
  scheme: ExportTheme;                       // "dark" mirrors the app chrome; "light" = print paper
  bg: string;
  fg: string;
  muted: string;
  border: string;
  cell: string;                              // calendar cell / card background
  head: string;                              // header-row / column-head background
  accent: string;
  tokens: Record<PaletteToken, string>;      // category/status palette
  font: string;                              // body font-family stack (the app's font)
}

// Per-export choices layered on top of (path, format, theme). All fields are
// BASE-ONLY except where noted; non-base files ignore them entirely.
export interface ExportOptions {
  // Which view of the base to export — index into BaseConfig.views. Default 0
  // (the first view, the historical hardcoded behavior).
  viewIndex: number;
  // Data table vs rendered view. Default is derived per view kind in the UI
  // (calendar/cards/kanban/list → "visual"; table/charts/etc → "data").
  mode: RenderMode;
  // Calendar visual export only (mode === "visual" && view.type === "calendar").
  calSpan: CalSpan;             // default "month"
  calStart: string;             // anchor date "YYYY-MM-DD"; "" = today (resolved in the renderer)
  weekStartsOnMonday: boolean;  // week/month grid start; default true
  militaryTime: boolean;        // 24h vs 12h event times; default false

  // Whether the note's leading YAML frontmatter block is included in the exported output.
  // Applies only to a plain (non-base) `.md` file: `md` export keeps/strips the raw block;
  // `html`/`pdf`/`png` keep/strip it from the rendered body before `renderMarkdown`. Default
  // true (the historical behavior — the raw file, frontmatter included, passed straight
  // through / rendered as-is). Bases/sheets/drawings ignore this entirely (a base's
  // frontmatter is config, never rendered as content in the first place).
  includeFrontmatter: boolean;

  // Resolved live-theme palette so the export matches the app (colors + font). Undefined
  // headlessly (CLI) → the renderer uses DEFAULT_PALETTE for the chosen theme.
  palette?: ThemePalette;
}

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
  // Present only for a PNG export of a note split by `<!-- pagebreak -->` markers — one entry
  // per marker-delimited section (see export/pageBreaks.ts), each an independent PNG. When
  // present, `bytes`/`filename`/`previewImg` above mirror `files[0]` (the first page), so a
  // caller that only looks at the single-result fields still gets a sensible file; a
  // page-break-aware caller (ExportView's doExport) writes/downloads every entry instead.
  files?: { filename: string; bytes: Uint8Array }[];
}

// Impure dependencies injected so exporters.ts stays unit-testable.
export interface ExportDeps {
  read: (path: string) => Promise<string>;
  resolveRows: (spec: SourceSpec) => Promise<Row[]>;
  htmlToPdf: (html: string) => Promise<Uint8Array>;
  // The paginated US-Letter pages of `html` as image data: URLs (one per page) — the SAME
  // pages htmlToPdf writes. Used by the PDF export PREVIEW to show the exact multi-page
  // 8.5x11in / 1in-margin layout the downloaded PDF has (rendering the real pages, not the raw
  // source HTML). Browser-only (html2canvas), like htmlToPdf/htmlToPng.
  htmlToPdfPages: (html: string) => Promise<string[]>;
  htmlToPng: (html: string) => Promise<{ bytes: Uint8Array; dataUrl: string }>;
  drawingToPng: (docText: string, theme: ExportTheme) => Promise<{ bytes: Uint8Array; dataUrl: string }>;
  // Inline KaTeX stylesheet (CSS + base64 woff2 fonts) for exports that contain rendered math.
  // Injected because the impl is environment-specific: the app supplies the Vite `?inline`-bundled
  // module (./katexCss), while headless/bun consumers (cli) can't resolve those Vite imports — so
  // routing it through deps keeps katexCss.ts OUT of any bun-compiled bundle (e.g. the cli binary).
  katexCss: () => Promise<string>;
}
