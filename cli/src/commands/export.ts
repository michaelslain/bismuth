// Universal `export` — note / base / sheet / drawing → md | html | png | pdf.
// Reuses the app's own exporter (app/src/export/exporters.ts) so CLI output matches
// the in-app export exactly, injecting headless deps. Every format is fully headless:
// pdf/png of notes/bases/sheets drive real headless Chrome over CDP
// (core/src/render/htmlRaster.ts) against the exact HTML the browser exporter itself
// produces, so there is no fidelity gap against what the app shows. Drawings go straight
// through the headless core renderer (core/src/drawing/export.ts). PROSE LEADING and the
// HEADING SCALE both track the vault's own editor.lineHeight/appearance.editorFontSize (see
// buildPaletteOverride below), so a note's typography matches the app; colour and body font
// still fall back to DEFAULT_PALETTE, since there is no DOM here to resolve the live theme from.
import { writeFileSync } from 'node:fs'
import type { CommandMap } from '../types'
import { flag, bool, requireVault, fail, today, out } from '../args'
import { readNote } from '../../../core/src/files'
import { resolveSource } from '../../../core/src/bases/source'
import { parseDoc } from '../../../core/src/drawing/model'
import { renderDocToPng } from '../../../core/src/drawing/export'
import { renderDrawFile } from './draw'
import {
    htmlToPdfHeadless,
    htmlToPngHeadless,
} from '../../../core/src/render/htmlRaster'
import { katexInlineCss } from '../katexCss'
import { docFontInlineCss } from '../docFontCss'
import { renderExport } from '../../../app/src/export/exporters'
import { defaultExportOptions } from '../../../app/src/export/options'
import { DEFAULT_PALETTE, PROSE_SCALE } from '../../../app/src/export/exportTheme'
import { readSettings } from '../../../core/src/settings'
import { FONT_STACKS } from '../../../app/src/settings'
import type {
    ExportFormat,
    ExportDeps,
    ExportOptions,
    RenderMode,
    CalSpan,
    ThemePalette,
} from '../../../app/src/export/types'

// The app's row unit (--row-h, ui.css :root) — the fixed constant the app's own live probe
// (resolvePalette.ts) divides through when it turns editor.lineHeight into a leading RATIO.
// Mirrored here, not re-derived, so a change to the token in the app is the only place this
// can drift from. --prose-scale itself is imported above as PROSE_SCALE, not mirrored, so
// there is exactly one place that constant is written.
const ROW_H_PX = 18

// Schema defaults (core/src/schema/settingsSchema.ts) for a vault with no .settings, or with
// these two keys unset. Not imported from DEFAULTS there: it's derived as a generic
// Record<string, unknown>, so every field read off it is untyped — a literal fallback here is
// both simpler and doesn't need widening back to number at every use.
const DEFAULT_LINE_HEIGHT = 1.5 // editor.lineHeight
const DEFAULT_EDITOR_FONT_SIZE = 13.5 // appearance.editorFontSize

// Read the vault's editor.lineHeight + appearance.editorFontSize (falling back to the schema
// defaults above for a vault with no .settings, or with those keys unset) and turn them into the
// same proseLeading RATIO the live app computes in resolvePalette.ts's DOM probe. Colour and body
// font are NOT resolved here — there is no DOM headlessly, so those fields keep DEFAULT_PALETTE's
// values and the fidelity gap there remains (see this file's header comment).
async function buildPaletteOverride(
    vault: string,
    theme: 'dark' | 'light',
): Promise<ThemePalette> {
    const settings = await readSettings(vault)
    const data = (settings?.data ?? {}) as {
        editor?: { lineHeight?: number }
        appearance?: {
            editorFontSize?: number
            uiFont?: string
        }
    }
    const lineHeight = data.editor?.lineHeight ?? DEFAULT_LINE_HEIGHT
    const editorFontSize =
        data.appearance?.editorFontSize ?? DEFAULT_EDITOR_FONT_SIZE
    const proseLeading = (ROW_H_PX * lineHeight) / (editorFontSize * PROSE_SCALE)
    // The vault's own FACES, resolved the same way settingsCssVars.ts resolves them for the app:
    // a name out of FONT_STACKS, or the raw string when the user named a face the map does not
    // carry. appearance.uiFont is the one mono face — both the chrome face a base/calendar
    // export uses and the face everything outside prose returns to. Reading it is the point of
    // the exercise — an export should follow the vault rather than a constant chosen here.
    const stack = (name: string | undefined, dflt: string): string =>
        name ? (FONT_STACKS[name] ?? name) : dflt
    // The heading SCALE needs no vault input: it is the app's fixed design steps, and the ramp is
    // applied to the document's own body size inside the template.
    return {
        ...DEFAULT_PALETTE[theme],
        proseLeading,
        monoFont: stack(
            data.appearance?.uiFont,
            DEFAULT_PALETTE[theme].monoFont,
        ),
        font: stack(data.appearance?.uiFont, DEFAULT_PALETTE[theme].font),
    }
}

// Base-export options from flags (no-ops for non-base files). `--view` picks which view,
// `--mode data|visual` flat-table vs rendered view, `--cal-start`/`--cal-span` the calendar
// grid anchor + span.
function optionsFrom(args: string[]): ExportOptions {
    const o = defaultExportOptions()
    const view = flag(args, 'view')
    if (view !== undefined) o.viewIndex = Math.max(0, parseInt(view, 10) || 0)
    const mode = flag(args, 'mode')
    if (mode === 'visual' || mode === 'data') o.mode = mode as RenderMode
    const start = flag(args, 'cal-start')
    if (start) o.calStart = start
    const span = flag(args, 'cal-span')
    if (
        span === 'month' ||
        span === 'week' ||
        span === '3day' ||
        span === 'day'
    )
        o.calSpan = span as CalSpan
    if (bool(args, 'no-frontmatter')) o.includeFrontmatter = false
    // Default is now off (clean formatting) — this flag turns markdown-syntax markers ON.
    if (bool(args, 'markdown-syntax')) o.showMarkdownSyntax = true
    return o
}

async function run(args: string[]): Promise<void> {
    const file = args.find(a => !a.startsWith('--'))
    if (!file)
        fail(
            'usage: bismuth export <file> [--format md|html|png|pdf|csv] [--out FILE] [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day] [--no-frontmatter] [--markdown-syntax] [--theme dark|light]',
        )
    const fmt = (flag(args, 'format') ??
        (file.endsWith('.draw') ? 'png' : 'md')) as ExportFormat
    const themeArg = flag(args, 'theme') ?? 'dark'
    if (themeArg !== 'dark' && themeArg !== 'light')
        fail(`--theme must be "dark" or "light": ${themeArg}`)
    const theme = themeArg as 'dark' | 'light'

    // Drawings: headless core renderer (both png + pdf work without a browser).
    if (file.endsWith('.draw')) {
        if (fmt !== 'png' && fmt !== 'pdf')
            fail('a .draw file exports to png or pdf')
        await renderDrawFile(file, args, fmt === 'pdf')
        return
    }

    // Notes / bases / sheets: reuse the app exporter with headless deps.
    const vault = requireVault(args)
    const deps: ExportDeps = {
        read: p => readNote(vault, p),
        resolveRows: spec =>
            resolveSource(spec, { root: vault, today: today() }),
        // Headless: drives real Chrome over CDP (core/src/render/htmlRaster.ts) against the
        // exact HTML the browser exporter itself produces — no running Bismuth, no fidelity
        // gap against the app's own export.
        htmlToPdf: (html, _title) => htmlToPdfHeadless(html),
        htmlToPng: htmlToPngHeadless,
        // Inline KaTeX stylesheet + fonts read straight off the resolved `katex` package at
        // katexCss.ts — fonts embedded into the binary at COMPILE time via Bun's own
        // `with { type: 'file' }` asset imports, not looked up on disk at run time (see that
        // module's header for why require.resolve() cannot work here).
        katexCss: katexInlineCss,
        // The note faces themselves, inlined — without these the headless Chrome that rasterises
        // the pdf has no Lora Variable or Monaspace and silently falls through to Georgia.
        docFontCss: docFontInlineCss,
        // `box` (the note-ink shape) renders ONE page of strokes at that logical size on a
        // transparent ground, for compositing over the exported page's own text; without it
        // this is the historical full-sheet `.draw` render. See ExportDeps.drawingToPng.
        drawingToPng: async (docText, theme, box) => {
            const bytes = await renderDocToPng(parseDoc(docText), theme, box)
            return {
                bytes,
                dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
            }
        },
    }
    const options = optionsFrom(args)
    options.palette = await buildPaletteOverride(vault, theme)
    const res = await renderExport(file, fmt, deps, theme, options)
    // A `<!-- pagebreak -->`-split PNG note (see app/src/export/pageBreaks.ts) yields several
    // files, one per page — `--out` (a single path) doesn't apply, so each writes to its own
    // computed name. Unreachable today for the app-only png/pdf-of-notes paths above (they throw
    // before producing bytes), kept for when a headless PNG rasterizer lands.
    if (res.files && res.files.length > 1) {
        for (const f of res.files) writeFileSync(f.filename, f.bytes)
        out(`wrote ${res.files.map(f => f.filename).join(', ')}`, args)
        return
    }
    const outPath = flag(args, 'out') ?? res.filename
    writeFileSync(outPath, res.bytes)
    out(`wrote ${outPath}`, args)
}

export const commands: CommandMap = {
    export: {
        summary:
            'Export a note/base/sheet/drawing to md|html|png|pdf|csv',
        usage: '<file> [--format md|html|png|pdf|csv] [--out FILE] [--view N] [--mode data|visual] [--cal-start YYYY-MM-DD] [--cal-span month|week|3day|day] [--no-frontmatter] [--markdown-syntax] [--theme dark|light] [--vault <dir>]',
        run,
    },
}
