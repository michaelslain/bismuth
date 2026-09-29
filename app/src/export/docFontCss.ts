// app/src/export/docFontCss.ts
//
// The DOCUMENT faces — the note prose serif (IBM Plex Serif or Lora Variable, whichever the
// document's prose stack names) and the mono face (Monaspace Xenon) — inlined
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
// The faces mirror the app's own declarations one for one — index.tsx's @fontsource imports for
// the prose serifs (Plex as static cuts; Lora as two VARIABLE files covering the whole 400-700
// weight axis — see fontFaceCss.ts's DOC_FACES comment) and its @fontsource imports for the mono.
//
// Browser build only: `?inline` is a Vite transform. Headless/bun consumers get the same
// stylesheet from cli/src/docFontCss.ts, which is why this is threaded through ExportDeps rather
// than imported directly by exporters.ts.
import plex400 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-400-normal.woff2?inline'
import plex400i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-400-italic.woff2?inline'
import plex500 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-500-normal.woff2?inline'
import plex500i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-500-italic.woff2?inline'
import plex600 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-600-normal.woff2?inline'
import plex600i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-600-italic.woff2?inline'
import plex700 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-700-normal.woff2?inline'
import plex700i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-700-italic.woff2?inline'
import loraNormal from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?inline'
import loraItalic from '@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?inline'
import monaspace400 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-normal.woff2?inline'
import monaspace400i from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-italic.woff2?inline'
import monaspace700 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-700-normal.woff2?inline'
import { DOC_FACES, faceCss, proseFacesFor, type DocFace } from './fontFaceCss'

// One inlined file per DOC_FACES entry, in the same order — the list is the shared half, only
// how the bytes arrive differs from cli/src/docFontCss.ts.
const SRCS = [
    plex400,
    plex400i,
    plex500,
    plex500i,
    plex600,
    plex600i,
    plex700,
    plex700i,
    loraNormal,
    loraItalic,
    monaspace400,
    monaspace400i,
    monaspace700,
]
const FACES: DocFace[] = DOC_FACES.map((f, i) => ({ ...f, src: SRCS[i]! }))

const cache = new Map<string, string>()

/**
 * `@font-face` declarations for the note faces with every file inlined — safe in a standalone
 * export document with no font files alongside it, and readable by the headless Chrome the PDF
 * path rasterises in. `proseStack` is the document's prose font stack; only the serif it names is
 * embedded (proseFacesFor). Cached per stack.
 */
export function docFontInlineCss(proseStack: string): string {
    const hit = cache.get(proseStack)
    if (hit !== undefined) return hit
    const css = faceCss(proseFacesFor(FACES, proseStack))
    cache.set(proseStack, css)
    return css
}
