// core/src/fileKinds.ts
//
// Shared classification of "binary" vault files (images + PDFs) and their two sidecars: the
// tag-carrying companion note `<file>.md` and the ink-annotation sidecar `<file>.draw`. One
// source of truth for which extensions count as images/PDFs, so the file tree (files.ts), the
// mobile mirror (app/src/mobile/tauriFileAccess.ts) and the preview surface
// (app/src/preview/previewKind.ts) never drift against each other. Pure, framework-free.

/** Image extensions the tree lists + the preview surface renders inline. Lowercased, no dot. */
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'avif',
    'bmp',
    'ico',
    'svg',
    'heic',
    'heif',
    'tif',
    'tiff',
])

/** Lowercased extension of a path's basename, with no leading dot — '' when the basename has no
 *  extension, INCLUDING a leading-dot dotfile (`.gitignore` → ''), so a dotfile is never mistaken
 *  for an extension-only name. */
export function extOfPath(path: string): string {
    const base = path.split('/').pop() ?? path
    const dot = base.lastIndexOf('.')
    if (dot <= 0) return '' // no dot, or a leading-dot dotfile
    return base.slice(dot + 1).toLowerCase()
}

export function isImagePath(path: string): boolean {
    return IMAGE_EXTS.has(extOfPath(path))
}

export function isPdfPath(path: string): boolean {
    return extOfPath(path) === 'pdf'
}

/** True for a file kind that can carry a tag companion + ink sidecar — images and PDFs. */
export function isCompanionable(path: string): boolean {
    return isImagePath(path) || isPdfPath(path)
}

/** The tag-carrying companion note for a binary file — `photo.png` → `photo.png.md`. Its
 *  frontmatter holds `tags:`; it's a real note so the vault pipeline indexes it normally. */
export function companionPathFor(binaryPath: string): string {
    return `${binaryPath}.md`
}

/** The ink-annotation sidecar for a binary file — `photo.png` → `photo.png.draw`. */
export function inkSidecarFor(binaryPath: string): string {
    return `${binaryPath}.draw`
}

/** The binary a companion note stands for, or null when `mdPath` isn't a companion — either it
 *  doesn't end in `.md`, or stripping that suffix doesn't leave an image/PDF path (a plain note
 *  `notes.md`, or a companion-shaped double extension `x.png.md.md`, whose stripped `x.png.md`
 *  is not itself companionable). Case-insensitive, matching extOfPath. */
export function binaryForCompanion(mdPath: string): string | null {
    if (extOfPath(mdPath) !== 'md') return null
    const binary = mdPath.slice(0, mdPath.length - '.md'.length)
    return isCompanionable(binary) ? binary : null
}

/** listTree's name-based predicate: which files the tree considers at all, BEFORE the
 *  companion-hiding pass that drops a `.md`/`.draw` sidecar whose companionable sibling is
 *  present. Notes, drawings, sheets, settings-adjacent yaml, plus every companionable binary. */
export function isTreeListedName(name: string): boolean {
    const ext = extOfPath(name)
    return (
        ext === 'md' ||
        ext === 'draw' ||
        ext === 'sheet' ||
        ext === 'yaml' ||
        ext === 'yml' ||
        isImagePath(name) ||
        isPdfPath(name)
    )
}
