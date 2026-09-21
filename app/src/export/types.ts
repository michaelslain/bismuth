// app/src/export/types.ts
import type { Row, SourceSpec } from '../../../core/src/bases/types'
import type { InkBox } from '../../../core/src/drawing/model'
import type { PaletteTokenName } from '../ui/palette'

export type ExportFormat = 'html' | 'pdf' | 'md' | 'png' | 'csv'

export type ExportTheme = 'dark' | 'light'

// How a `type: base` md file is exported. "data" = the chosen view's flat table
// (markdown/csv/html table — the historical behavior); "visual" = the view rendered
// AS ITS KIND (calendar grid / cards / kanban / list). Ignored for non-base files
// (prose md / sheet / draw always behave as before).
export type RenderMode = 'visual' | 'data'

// Calendar visual-export span (mirrors the live calendar's ViewType).
export type CalSpan = 'month' | 'week' | '3day' | 'day'

export type PaletteToken = PaletteTokenName

// Concrete (already-resolved) theme values the export inlines so it matches the live app.
// Built in the browser from the app's runtime CSS vars (which settingsCssVars projects from
// the active theme + settings); the export doc can't reference var()/color-mix, so every
// value here is a literal color/font. Headless callers (CLI) fall back to DEFAULT_PALETTE.
export interface ThemePalette {
    scheme: ExportTheme // "dark" mirrors the app chrome; "light" = print paper
    bg: string
    fg: string
    muted: string
    border: string
    cell: string // calendar cell / card background
    head: string // header-row / column-head background
    accent: string
    tokens: Record<PaletteToken, string> // category/status palette
    font: string // body font-family stack (the app's UI font)
    // Note-prose typography, resolved live from the app's CSS custom properties (which
    // settingsCssVars projects from .settings) so an exported NOTE reads in the face and on the
    // leading the editor is actually showing. A base's visual export keeps `font` above, because
    // that is what those surfaces use in the app. Headless callers get DEFAULT_PALETTE's values.
    proseFont: string // --prose-font (the proportional note face)
    // The MONO face, and — like `font` above — driven by --ui-font-stack (appearance.uiFont).
    // This used to be a SEPARATE token (--editor-font / appearance.editorFont) from `font`
    // above, before the two settings were collapsed into the one appearance.uiFont; monoFont
    // stays its own field regardless, because the export used to have no handle on it at all
    // and its mono scoping had to borrow `font`, which rendered frontmatter in a sans-serif —
    // keeping the field explicit is what stops that regression from coming back if the two are
    // ever split again.
    monoFont: string
    // Line height as a ratio OF THE PROSE FONT SIZE. Deliberately not editor.lineHeight itself:
    // that setting is a multiple of the app's 18px row unit, not of the type, so pasting it onto
    // a different font size produces a different (and at the default, badly cramped) leading. The
    // ratio is what transfers. Resolved live by reading back the app's own
    // `calc(var(--row-h) * var(--prose-line-height))` against `var(--prose-font-size)`.
    //
    // Note there is deliberately no --prose-scale here. In the app that scale exists so a serif
    // reads at the same OPTICAL size as the mono chrome beside it at the same nominal size. An
    // export document has no mono chrome to match, and the pt picker is already the intended
    // reading size — scaling it would silently turn a chosen 12pt into 15.36pt.
    proseLeading: number
    // The app's own NOTE HEADING scale, resolved to concrete values. Exported notes used to set no
    // heading font-size at all, so every level fell back to the browser's defaults — a different
    // ramp AND a different shape from the app's. In the app (editor/livePreview.ts, sizes in
    // styles/tokens.css) h3 and h4 sit AT body size and differ only in weight, while h5/h6 change
    // REGISTER (uppercase + tracking) rather than merely shrinking; the browser defaults instead
    // step h3 ABOVE body and shrink h5/h6 into small body text.
    //
    // The fixed design STEPS, not resolved heading sizes — see TypeScale for why that distinction
    // is load-bearing. A numeric step must never arrive as a `var()` string: getPropertyValue on a
    // custom property returns its SPECIFIED text (custom properties are substituted, not
    // computed), so resolvePalette assigns each to a real property on a probe element and reads
    // the computed value back, the same technique proseLeading uses. The em-valued TRACKING is the
    // exception and is read as literal text, because resolving an em against a probe resolves it
    // against the PROBE's font size, which is not the size it will render at.
    type: TypeScale
}

/** The app's note type scale: the fixed design STEPS plus how each level is treated.
 *
 *  Deliberately NOT six resolved heading sizes. The app's ramp is relative to ITS body size
 *  (`--fs-h3: var(--editor-font-size)` — h3 IS body), and an export's body size is the point size
 *  the user picked, a completely independent setting. Carrying resolved pixels meant heading size
 *  came from `appearance.editorFontSize` while the line box came from the export's point size, so
 *  at editorFontSize 28 and a 9pt export an h3 rendered 28px of glyph inside a 5px line box — a
 *  23px overflow, an order of magnitude worse than the 4px defect this scale was introduced to
 *  fix. The STEPS transfer; the sizes are computed against whatever body the export is set in. */
export interface TypeScale {
    /** --fs-display: the h1 floor. */
    stepDisplayPx: number
    /** --fs-title: the h2 floor. */
    stepTitlePx: number
    /** --fs-body: the h5/h6 ceiling. */
    stepBodyPx: number
    /** Heading weights, h1 first. */
    headingWeight: [number, number, number, number, number, number]
    /** --lh-tight: the ratio h1/h2 use instead of the prose leading. */
    lhTight: number
    /** --ls-display, applied to h1. Kept in its authored unit (em), never resolved to px. */
    lsDisplay: string
    /** --ls-label, the tracking that puts h5/h6 in a label register alongside uppercase. */
    lsLabel: string
}

/** The app's ramp, applied to whatever body size a document is actually set in. Mirrors
 *  tokens.css's max()/min() forms; h1 first. */
export function headingSizes(
    ts: TypeScale,
    bodyPx: number,
): [number, number, number, number, number, number] {
    return [
        Math.max(ts.stepDisplayPx, bodyPx),
        Math.max(ts.stepTitlePx, bodyPx),
        bodyPx,
        bodyPx,
        Math.min(ts.stepBodyPx, bodyPx),
        Math.min(ts.stepBodyPx, bodyPx),
    ]
}

// Per-export choices layered on top of (path, format, theme). All fields are
// BASE-ONLY except where noted; non-base files ignore them entirely.
export interface ExportOptions {
    // Which view of the base to export — index into BaseConfig.views. Default 0
    // (the first view, the historical hardcoded behavior).
    viewIndex: number
    // Data table vs rendered view. Default is derived per view kind in the UI
    // (calendar/cards/kanban/list → "visual"; table/charts/etc → "data").
    mode: RenderMode
    // Calendar visual export only (mode === "visual" && view.type === "calendar").
    calSpan: CalSpan // default "month"
    calStart: string // anchor date "YYYY-MM-DD"; "" = today (resolved in the renderer)
    weekStartsOnMonday: boolean // week/month grid start; default true
    militaryTime: boolean // 24h vs 12h event times; default false

    // Body font size (in points) for the PDF export. Applied to the wrapped document's <body>
    // for the pdf format only (html/png/md/csv keep their intrinsic sizing). Larger sizes make
    // the rendered text bigger AND repaginate (taller content overflows onto more Letter pages).
    // Default 12 (a standard document body size). The PDF raster is laid out at the 6.5in
    // printable width @ 96dpi, so 1 CSS point maps to 1 PDF point — the chosen size is true.
    pdfFontSize: number

    // Whether the note's leading YAML frontmatter block is included in the exported output.
    // Applies only to a plain (non-base) `.md` file: `md` export keeps/strips the raw block;
    // `html`/`pdf`/`png` keep/strip it from the rendered body before `renderMarkdown`. Default
    // true (the historical behavior — the raw file, frontmatter included, passed straight
    // through / rendered as-is). Bases/sheets/drawings ignore this entirely (a base's
    // frontmatter is config, never rendered as content in the first place).
    includeFrontmatter: boolean

    // Whether markdown syntax markers are rendered in the exported output — the literal
    // "## "/"### "/…/"###### " prefix shown before h2-h6 headings (mirrors the app's own editor
    // aesthetic; h1 never gets one, since it's the document title). Applies to the rendered-prose
    // formats (html/pdf/png); md is already raw markdown text and csv has no headings, so both
    // ignore this. Default false: clean, "read nicely formatted" output with no markdown syntax
    // showing (the repo owner's ask, after an export literally rendered "## Problem 1" as visible
    // text) — turn on to reveal the markers.
    showMarkdownSyntax: boolean

    // Resolved live-theme palette so the export matches the app (colors + font). Undefined
    // headlessly (CLI) → the renderer uses DEFAULT_PALETTE for the chosen theme.
    palette?: ThemePalette
}

// What the export tab displays. Every format but PDF stays cheap — no export bytes, no
// html->pdf pipeline. PDF is the one exception: the preview now runs the REAL print (the same
// bytes as the download), because that's the only way to show WebKit's own pagination/fonts —
// see ExportPreview.previewPdf.
export interface ExportPreview {
    previewHtml?: string // shown in an <iframe srcdoc> (isolated document)
    previewImg?: string // data: URL, shown in an <img> (drawings)
    // The real PDF bytes (from the SAME engine the download uses), rendered by the app's
    // PdfPages pdf.js stack. Set only for format === 'pdf'; previewHtml/previewImg are unset then.
    previewPdf?: Uint8Array
}

export interface ExportResult {
    bytes: Uint8Array
    mime: string
    filename: string // e.g. "note.html"
    previewHtml?: string
    previewImg?: string
    // Present only for a PNG export of a note split by `<!-- pagebreak -->` markers — one entry
    // per marker-delimited section (see export/pageBreaks.ts), each an independent PNG. When
    // present, `bytes`/`filename`/`previewImg` above mirror `files[0]` (the first page), so a
    // caller that only looks at the single-result fields still gets a sensible file; a
    // page-break-aware caller (ExportView's doExport) writes/downloads every entry instead.
    files?: { filename: string; bytes: Uint8Array }[]
}

// Impure dependencies injected so exporters.ts stays unit-testable.
export interface ExportDeps {
    read: (path: string) => Promise<string>
    resolveRows: (spec: SourceSpec) => Promise<Row[]>
    // Desktop: native WebKit print via the `print_pdf` Tauri command (real selectable text,
    // WebKit's own pagination — a line box is never split, correct KaTeX). Everywhere else:
    // html2canvas + jsPDF (app/src/export/htmlToPdf.ts). `title` becomes the PDF's Title metadata.
    // See app/src/export/pdfPrint.ts for the engine chooser + canvas fallback.
    htmlToPdf: (html: string, title: string) => Promise<Uint8Array>
    htmlToPng: (html: string) => Promise<{ bytes: Uint8Array; dataUrl: string }>
    // Rasterizes a `.draw` document. `box` is the note-ink shape (inkHtml.ts): ONE page of
    // strokes at a caller-chosen logical size on a TRANSPARENT ground, for compositing over the
    // exported page's own text. Omitted — the historical shape, and the only one a `.draw` file
    // export uses — means a full PAGE_W x PAGE_H sheet with its paper background, which is
    // exactly wrong for an annotation: an opaque ground hides the words it is drawn on.
    drawingToPng: (
        docText: string,
        theme: ExportTheme,
        box?: InkBox,
    ) => Promise<{ bytes: Uint8Array; dataUrl: string }>
    // Inline KaTeX stylesheet (CSS + base64 woff2 fonts) for exports that contain rendered math.
    // Injected because the impl is environment-specific: the app supplies the Vite `?inline`-bundled
    // module (./katexCss), while headless/bun consumers (cli) can't resolve those Vite imports — so
    // routing it through deps keeps katexCss.ts OUT of any bun-compiled bundle (e.g. the cli binary).
    katexCss: () => Promise<string>
    // The DOCUMENT faces (note prose + mono), inlined the same way and for the same reason as
    // katexCss above: the export NAMED these families but shipped neither file, so a standalone
    // document — and the headless Chrome the PDF path rasterises in — fell through to the next
    // entry in the stack. Measured on a real export: prose painted at Georgia's width, not the
    // real prose face's width, while the maths rendered in a real embedded face because only
    // KaTeX was embedded. Optional so a caller that genuinely wants the viewer's own fonts can
    // omit it.
    docFontCss?: () => Promise<string>
}
