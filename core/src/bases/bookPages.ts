// core/src/bases/bookPages.ts
// The book view's page list model: which files a base's rows name, how a PDF expands into
// leaves, and which leaves share a spread. Pure: no fs, so the app and the routes share it.

import { binaryForCompanion, isImagePath, isPdfPath } from '../fileKinds'
import { resolveProperty } from './query'
import type { Row, ViewConfig } from './types'

export type BookPageKind = 'image' | 'pdf'
/** `file` is the vault-relative path of the page file; `rowIndex` indexes the rows passed in. */
export type BookPageRef = { file: string; kind: BookPageKind; rowIndex: number }
/** `pdfPage` is 1-based. */
export type BookLeaf = { ref: BookPageRef; pdfPage?: number }
/** Leaf indices shown on each side of a spread. */
export type Spread = { left?: number; right?: number }
export type BookLayout = 'spread' | 'single'

/** The vault path inside `"[[x.jpg]]"`, `"![[x.jpg|alias]]"`, `"x.jpg"` or `"dir/x.jpg"`. */
function pathOf(value: unknown): string | null {
    if (typeof value !== 'string') return null
    let v = value.trim()
    const wiki = v.match(/^!?\[\[(.*)\]\]$/)
    if (wiki) v = wiki[1]
    v = v.split('|')[0].split('#')[0].trim()
    return v || null
}

export function kindOf(path: string): BookPageKind | null {
    if (isImagePath(path)) return 'image'
    if (isPdfPath(path)) return 'pdf'
    return null
}

export function bookPageRefs(rows: Row[], view: ViewConfig): BookPageRef[] {
    const column = view.page || 'page'
    const refs: BookPageRef[] = []
    rows.forEach((row, rowIndex) => {
        const named = pathOf(resolveProperty(column, row))
        const file = named ?? binaryForCompanion(row.file.path)
        if (!file) return
        const kind = kindOf(file)
        if (kind) refs.push({ file, kind, rowIndex })
    })
    return refs
}

export function expandLeaves(
    refs: BookPageRef[],
    pdfPageCounts: ReadonlyMap<string, number>,
): BookLeaf[] {
    const leaves: BookLeaf[] = []
    for (const ref of refs) {
        if (ref.kind === 'image') {
            leaves.push({ ref })
            continue
        }
        const n = pdfPageCounts.get(ref.file) ?? 0
        if (n <= 0) leaves.push({ ref, pdfPage: 1 })
        else for (let p = 1; p <= n; p++) leaves.push({ ref, pdfPage: p })
    }
    return leaves
}

const clampLeaf = (leaf: number, count: number): number =>
    Math.max(0, Math.min(leaf, count - 1))

/** Spread layout puts leaf 0 alone on the right (the cover), then pairs [1,2], [3,4], …; an
 *  even count ends with the last leaf alone on the left. Single layout shows one leaf. */
export function spreadFor(
    leaf: number,
    count: number,
    layout: BookLayout,
): Spread {
    if (count <= 0) return {}
    const at = clampLeaf(leaf, count)
    if (layout === 'single') return { right: at }
    if (at === 0) return { right: 0 }
    const left = at % 2 === 1 ? at : at - 1
    const right = left + 1
    return right < count ? { left, right } : { left }
}

/** The first leaf of the next (`1`) or previous (`-1`) spread, clamped to the book. */
export function stepSpread(
    leaf: number,
    count: number,
    layout: BookLayout,
    dir: 1 | -1,
): number {
    if (count <= 0) return 0
    const s = spreadFor(leaf, count, layout)
    const first = s.left ?? s.right ?? 0
    const last = s.right ?? s.left ?? 0
    if (dir === 1) return Math.min(last + 1, count - 1) === last ? first : last + 1
    return first === 0 ? 0 : spreadFor(first - 1, count, layout).left ?? first - 1
}
