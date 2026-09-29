// app/src/export/fontFaceCss.ts
//
// The face LIST and its serialisation, with no asset imports of any kind — which is the whole
// point of the file. The two embedders that use it obtain font bytes by incompatible means (Vite
// `?inline` in the browser build, Bun import attributes in the compiled cli binary) and neither
// can import the other's module. Keeping the shared half here means the two paths cannot drift in
// which weights they declare or how they are written out, only in how the bytes are fetched.
export interface DocFace {
    family: string
    style: 'normal' | 'italic'
    /** A single weight, or a variable font axis range like '400 700'. */
    weight: number | string
    /** An already-inlined `data:` URI, never a path. */
    src: string
}

/** Which faces an exported note document CAN ship, mirroring the app's own declarations:
 *  index.tsx's @fontsource imports for the two prose serifs and for the mono. IBM Plex Serif
 *  (the default appearance.proseFont) ships as static cuts, one file per weight × style, matching
 *  the weights the app loads. Lora ships as two VARIABLE files (one normal, one italic, each
 *  covering the whole 400-700 weight axis) rather than four static cuts — hence two faces.
 *  Only the prose serif the document actually names is embedded — see proseFacesFor. */
export const DOC_FACES: Omit<DocFace, 'src'>[] = [
    { family: 'IBM Plex Serif', style: 'normal', weight: 400 },
    { family: 'IBM Plex Serif', style: 'italic', weight: 400 },
    { family: 'IBM Plex Serif', style: 'normal', weight: 500 },
    { family: 'IBM Plex Serif', style: 'italic', weight: 500 },
    { family: 'IBM Plex Serif', style: 'normal', weight: 600 },
    { family: 'IBM Plex Serif', style: 'italic', weight: 600 },
    { family: 'IBM Plex Serif', style: 'normal', weight: 700 },
    { family: 'IBM Plex Serif', style: 'italic', weight: 700 },
    { family: 'Lora Variable', style: 'normal', weight: '400 700' },
    { family: 'Lora Variable', style: 'italic', weight: '400 700' },
    { family: 'Monaspace Xenon', style: 'normal', weight: 400 },
    { family: 'Monaspace Xenon', style: 'italic', weight: 400 },
    { family: 'Monaspace Xenon', style: 'normal', weight: 700 },
]

/** The PROSE serif families DOC_FACES carries — the faces that are embedded only on demand. */
const PROSE_FAMILIES = ['IBM Plex Serif', 'Lora Variable']

/** The subset of `faces` a document whose prose is set in `proseStack` (a CSS font stack, as
 *  --prose-font / ThemePalette.proseFont carry it) needs: every non-prose face, plus a prose
 *  serif only when the stack names it. Shipping both serifs in every export would double the
 *  prose payload for a face the document never paints. Matched on the QUOTED family, the form
 *  FONT_STACKS writes, so 'Lora' cannot match 'Lora Variable' by prefix. */
export function proseFacesFor<F extends { family: string }>(
    faces: F[],
    proseStack: string,
): F[] {
    // A stack read back off the DOM may come quoted either way.
    const stack = proseStack.replace(/"/g, "'")
    return faces.filter(
        f =>
            !PROSE_FAMILIES.includes(f.family) ||
            stack.includes(`'${f.family}'`),
    )
}

export function faceCss(faces: DocFace[]): string {
    return faces
        .map(
            f =>
                `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${f.src}) format('woff2')}`,
        )
        .join('\n')
}
