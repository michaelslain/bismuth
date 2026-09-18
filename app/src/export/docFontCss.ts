// app/src/export/docFontCss.ts
//
// The DOCUMENT faces — note prose (Lora Variable) and the mono face (Monaspace Xenon) — inlined
// as base64 `data:` URIs for export, exactly as katexCss.ts already does for the maths glyphs.
//
// WHY THIS EXISTS. The export named these families in its font stacks but shipped neither file.
// The app loads them from node_modules through Vite; a standalone exported document has no such
// resolution, and the PDF path rasterises in a headless Chrome that is equally unaware of them. So
// every export fell through the stack to the next entry — measured directly on a real export: a
// prose run painted 737.1px wide, identical to Georgia's 737.1px and nothing like the real prose
// face's width. Meanwhile KaTeX's faces WERE embedded, so a document rendered its maths in a real
// face and its prose in Georgia: two different serifs a few pixels apart, which is precisely what
// "something looks wrong" turned out to be. This module shipped the wrong family once already
// (the previous static serif, before the app's prose face moved to Lora) — exporters.test.ts proves the CURRENT
// family actually resolves (a real rendered-width measurement), not just that it's named.
//
// The faces mirror the app's own declarations one for one — index.tsx's @fontsource-variable/lora
// imports for the prose serif (two VARIABLE files, one normal one italic, each covering the whole
// 400-700 weight axis — NOT four static cuts, see fontFaceCss.ts's DOC_FACES comment) and
// index.tsx's @fontsource imports for the mono.
//
// Browser build only: `?inline` is a Vite transform. Headless/bun consumers get the same
// stylesheet from cli/src/docFontCss.ts, which is why this is threaded through ExportDeps rather
// than imported directly by exporters.ts.
import loraNormal from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?inline'
import loraItalic from '@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?inline'
import monaspace400 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-normal.woff2?inline'
import monaspace400i from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-italic.woff2?inline'
import monaspace700 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-700-normal.woff2?inline'
import { faceCss } from './fontFaceCss'

let cached: string | null = null

/**
 * `@font-face` declarations for the note faces with every file inlined — safe in a standalone
 * export document with no font files alongside it, and readable by the headless Chrome the PDF
 * path rasterises in. Cached after the first build.
 */
export function docFontInlineCss(): string {
    if (cached !== null) return cached
    cached = faceCss([
        {
            family: 'Lora Variable',
            style: 'normal',
            weight: '400 700',
            src: loraNormal,
        },
        {
            family: 'Lora Variable',
            style: 'italic',
            weight: '400 700',
            src: loraItalic,
        },
        {
            family: 'Monaspace Xenon',
            style: 'normal',
            weight: 400,
            src: monaspace400,
        },
        {
            family: 'Monaspace Xenon',
            style: 'italic',
            weight: 400,
            src: monaspace400i,
        },
        {
            family: 'Monaspace Xenon',
            style: 'normal',
            weight: 700,
            src: monaspace700,
        },
    ])
    return cached
}
