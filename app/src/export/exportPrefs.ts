// The export pane's remembered choices. Two scopes:
// - ExportPrefs: the formatting options (format, theme, PDF size, frontmatter, markdown syntax),
//   shared by every export pane, so a choice carries to the next export.
// - ExportTabState: what belongs to one tab (a re-pointed source, a hand-picked mode, the
//   calendar start), keyed by the path the tab was opened for.
// Stored values are untrusted (hand-edited or from an older build), so every field is checked
// and an invalid one falls back to its default.
import { DEFAULT_PDF_FONT_SIZE, PDF_FONT_SIZES } from './options'
import type { ExportFormat, ExportTheme, RenderMode } from './types'

export type ExportPrefs = {
    format?: ExportFormat
    theme: ExportTheme
    pdfFontSize: number
    includeFrontmatter: boolean
    showMarkdownSyntax: boolean
}

export type ExportTabState = {
    src?: string
    mode?: RenderMode
    calStart: string
}

const FORMATS: readonly string[] = ['html', 'pdf', 'md', 'png', 'csv']

const obj = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

export function parseExportPrefs(raw: unknown): ExportPrefs {
    const r = obj(raw)
    return {
        format: FORMATS.includes(r.format as string)
            ? (r.format as ExportFormat)
            : undefined,
        theme: r.theme === 'light' ? 'light' : 'dark',
        pdfFontSize: PDF_FONT_SIZES.includes(r.pdfFontSize as number)
            ? (r.pdfFontSize as number)
            : DEFAULT_PDF_FONT_SIZE,
        includeFrontmatter:
            typeof r.includeFrontmatter === 'boolean'
                ? r.includeFrontmatter
                : true,
        showMarkdownSyntax: r.showMarkdownSyntax === true,
    }
}

export function parseExportTabState(raw: unknown): ExportTabState {
    const r = obj(raw)
    return {
        src: typeof r.src === 'string' && r.src ? r.src : undefined,
        mode: r.mode === 'visual' || r.mode === 'data' ? r.mode : undefined,
        calStart:
            typeof r.calStart === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(r.calStart)
                ? r.calStart
                : '',
    }
}
