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

/** Which faces an exported note document ships, mirroring the app's own declarations:
 *  index.tsx's @fontsource-variable/lora imports for the prose serif and its @fontsource
 *  imports for the mono. Lora ships as two VARIABLE files (one normal, one italic, each
 *  covering the whole 400-700 weight axis) rather than four static cuts — hence two faces
 *  here instead of the four static serif faces this replaced. */
export const DOC_FACES: Omit<DocFace, 'src'>[] = [
    { family: 'Lora Variable', style: 'normal', weight: '400 700' },
    { family: 'Lora Variable', style: 'italic', weight: '400 700' },
    { family: 'Monaspace Xenon', style: 'normal', weight: 400 },
    { family: 'Monaspace Xenon', style: 'italic', weight: 400 },
    { family: 'Monaspace Xenon', style: 'normal', weight: 700 },
]

export function faceCss(faces: DocFace[]): string {
    return faces
        .map(
            f =>
                `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${f.src}) format('woff2')}`,
        )
        .join('\n')
}
