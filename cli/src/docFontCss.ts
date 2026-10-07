// cli/src/docFontCss.ts
//
// The headless twin of app/src/export/docFontCss.ts: the same document faces (the note prose
// serif — Libron, IBM Plex Serif or Lora Variable — and mono Monaspace Xenon) inlined as base64, but through Bun's import-attribute asset
// embedding instead of Vite's `?inline`, because this module ships inside a `bun build --compile`
// binary that runs on a machine with no `node_modules` anywhere near it.
//
// `with { type: 'file' }` is resolved and INLINED BY THE BUNDLER at build time, not looked up on
// disk at run time — the same mechanism cli/src/katexCss.ts documents, and the same reason
// `require.resolve()` is wrong here (it bakes in an absolute path from the BUILD machine). Each
// value below is a PATH into the binary's embedded virtual filesystem, read lazily via Bun.file().
//
// The face LIST is shared with the browser build via faceCss(), so the two paths cannot drift in
// which weights they ship — only in how the bytes are obtained.
import libron400 from '../../app/src/assets/fonts/libron/Libron-Regular.woff2' with { type: 'file' }
import libron400i from '../../app/src/assets/fonts/libron/Libron-Italic.woff2' with { type: 'file' }
import libron700 from '../../app/src/assets/fonts/libron/Libron-Bold.woff2' with { type: 'file' }
import libron700i from '../../app/src/assets/fonts/libron/Libron-BoldItalic.woff2' with { type: 'file' }
import plex400 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-400-normal.woff2' with { type: 'file' }
import plex400i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-400-italic.woff2' with { type: 'file' }
import plex500 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-500-normal.woff2' with { type: 'file' }
import plex500i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-500-italic.woff2' with { type: 'file' }
import plex600 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-600-normal.woff2' with { type: 'file' }
import plex600i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-600-italic.woff2' with { type: 'file' }
import plex700 from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-700-normal.woff2' with { type: 'file' }
import plex700i from '@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-700-italic.woff2' with { type: 'file' }
import loraNormal from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2' with { type: 'file' }
import loraItalic from '@fontsource-variable/lora/files/lora-latin-wght-italic.woff2' with { type: 'file' }
import monaspace400 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-normal.woff2' with { type: 'file' }
import monaspace400i from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-italic.woff2' with { type: 'file' }
import monaspace700 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-700-normal.woff2' with { type: 'file' }
import {
    DOC_FACES,
    faceCss,
    proseFacesFor,
} from '../../app/src/export/fontFaceCss'

// One embedded file per DOC_FACES entry, in the same order.
const PATHS = [
    libron400,
    libron400i,
    libron700,
    libron700i,
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
const FACES = DOC_FACES.map((f, i) => ({ ...f, path: PATHS[i]! }))

const cache = new Map<string, string>()

/** The note faces as inlined `@font-face` rules — only the prose serif `proseStack` names (see
 *  proseFacesFor). Cached per stack. */
export async function docFontInlineCss(proseStack: string): Promise<string> {
    const hit = cache.get(proseStack)
    if (hit !== undefined) return hit
    const faces = await Promise.all(
        proseFacesFor(FACES, proseStack).map(async f => ({
            family: f.family,
            style: f.style,
            weight: f.weight,
            src: `data:font/woff2;base64,${Buffer.from(
                await Bun.file(f.path).arrayBuffer(),
            ).toString('base64')}`,
        })),
    )
    const css = faceCss(faces)
    cache.set(proseStack, css)
    return css
}
