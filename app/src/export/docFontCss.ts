// app/src/export/docFontCss.ts
//
// The DOCUMENT faces — note prose (CMU Serif) and the mono face (Monaspace Xenon) — inlined as
// base64 `data:` URIs for export, exactly as katexCss.ts already does for the maths glyphs.
//
// WHY THIS EXISTS. The export named these families in its font stacks but shipped neither file.
// The app loads them from node_modules through Vite; a standalone exported document has no such
// resolution, and the PDF path rasterises in a headless Chrome that is equally unaware of them. So
// every export fell through the stack to the next entry — measured directly on a real export: a
// prose run painted 737.1px wide, identical to Georgia's 737.1px and nothing like CMU Serif's
// 677.2px. Meanwhile KaTeX's faces WERE embedded, so a document rendered its maths in real
// Computer Modern and its prose in Georgia: two different serifs a few pixels apart, which is
// precisely what "something looks wrong" turned out to be.
//
// The faces mirror the app's own declarations one for one — styles/cmu.css for the serif (note its
// comment: the upstream package declares `font-style: roman`, which CSS does not define, so these
// point at the same woff2 files with valid descriptors and a real 400/700 pair) and index.tsx's
// @fontsource imports for the mono.
//
// Browser build only: `?inline` is a Vite transform. Headless/bun consumers get the same
// stylesheet from cli/src/docFontCss.ts, which is why this is threaded through ExportDeps rather
// than imported directly by exporters.ts.
import cmuSerifRoman from 'computer-modern/fonts/cmu-serif-500-roman.woff2?inline'
import cmuSerifItalic from 'computer-modern/fonts/cmu-serif-500-italic.woff2?inline'
import cmuSerifBold from 'computer-modern/fonts/cmu-serif-700-roman.woff2?inline'
import cmuSerifBoldItalic from 'computer-modern/fonts/cmu-serif-700-italic.woff2?inline'
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
        { family: 'CMU Serif', style: 'normal', weight: 400, src: cmuSerifRoman },
        { family: 'CMU Serif', style: 'italic', weight: 400, src: cmuSerifItalic },
        { family: 'CMU Serif', style: 'normal', weight: 700, src: cmuSerifBold },
        {
            family: 'CMU Serif',
            style: 'italic',
            weight: 700,
            src: cmuSerifBoldItalic,
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
