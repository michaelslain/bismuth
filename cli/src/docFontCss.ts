// cli/src/docFontCss.ts
//
// The headless twin of app/src/export/docFontCss.ts: the same document faces (note prose CMU
// Serif, mono Monaspace Xenon) inlined as base64, but through Bun's import-attribute asset
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
import cmuSerifRoman from 'computer-modern/fonts/cmu-serif-500-roman.woff2' with { type: 'file' }
import cmuSerifItalic from 'computer-modern/fonts/cmu-serif-500-italic.woff2' with { type: 'file' }
import cmuSerifBold from 'computer-modern/fonts/cmu-serif-700-roman.woff2' with { type: 'file' }
import cmuSerifBoldItalic from 'computer-modern/fonts/cmu-serif-700-italic.woff2' with { type: 'file' }
import monaspace400 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-normal.woff2' with { type: 'file' }
import monaspace400i from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-400-italic.woff2' with { type: 'file' }
import monaspace700 from '@fontsource/monaspace-xenon/files/monaspace-xenon-latin-700-normal.woff2' with { type: 'file' }
import { faceCss } from '../../app/src/export/fontFaceCss'

const FACES: {
    family: string
    style: 'normal' | 'italic'
    weight: number
    path: string
}[] = [
    { family: 'CMU Serif', style: 'normal', weight: 400, path: cmuSerifRoman },
    { family: 'CMU Serif', style: 'italic', weight: 400, path: cmuSerifItalic },
    { family: 'CMU Serif', style: 'normal', weight: 700, path: cmuSerifBold },
    {
        family: 'CMU Serif',
        style: 'italic',
        weight: 700,
        path: cmuSerifBoldItalic,
    },
    {
        family: 'Monaspace Xenon',
        style: 'normal',
        weight: 400,
        path: monaspace400,
    },
    {
        family: 'Monaspace Xenon',
        style: 'italic',
        weight: 400,
        path: monaspace400i,
    },
    {
        family: 'Monaspace Xenon',
        style: 'normal',
        weight: 700,
        path: monaspace700,
    },
]

let cached: string | null = null

/** The note faces as inlined `@font-face` rules. Cached after the first build. */
export async function docFontInlineCss(): Promise<string> {
    if (cached !== null) return cached
    const faces = await Promise.all(
        FACES.map(async f => ({
            family: f.family,
            style: f.style,
            weight: f.weight,
            src: `data:font/woff2;base64,${Buffer.from(
                await Bun.file(f.path).arrayBuffer(),
            ).toString('base64')}`,
        })),
    )
    cached = faceCss(faces)
    return cached
}
