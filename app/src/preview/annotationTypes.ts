// app/src/preview/annotationTypes.ts
// Shared types for in-place annotations on an image/PDF preview: the one store that owns a
// binary's `.draw` sidecar, and the PDF navigation seams (outline + scroll controller). Types
// only — `createAnnotationStore.ts` implements the store, `PdfPages.tsx` the controller.
import type { Accessor } from 'solid-js'
import type { DrawingDoc, Highlight } from '../../../core/src/drawing/model'
import type { ScratchBlock } from '../../../core/src/scratchTypes'

export type AnnotationLoadState = 'loading' | 'ready' | 'failed'

/** The ONE owner of a binary's `.draw` sidecar while its preview is open. Ink, highlights,
 *  bookmarks and the margin toggle all edit through it, so there is one debounce, one undo
 *  stack, one writer. */
export type AnnotationStore = {
    doc: Accessor<DrawingDoc | null>
    loadState: Accessor<AnnotationLoadState>
    /** Apply a user edit. `fn` receives the current doc, or a fresh blank-paper doc when none
     *  exists yet. Pushes undo, clears redo, schedules the debounced save. No-op unless
     *  loadState is 'ready'. */
    edit: (fn: (d: DrawingDoc) => DrawingDoc) => void
    undo: () => void
    redo: () => void
    resetHistory: () => void
    /** Write any pending edit now. */
    flush: () => Promise<void>
    /** A PDF's highlights as they are in the PDF file (index = page): replaces the doc's
     *  highlights without an undo entry and resets the undo history. Called when a document loads
     *  or reloads after an external change. Arriving while edits are unsaved, it saves them first
     *  and keeps them on top of what arrived. Ignored while `highlightStore` is 'sidecar'. */
    setPdfHighlights: (pages: Highlight[][]) => void
    /** Where this file's highlights save: 'pdf' = inside the PDF (the default for a PDF), 'sidecar'
     *  = in the `.draw` file (an image, or a PDF Bismuth cannot rewrite). */
    highlightStore: Accessor<'pdf' | 'sidecar'>
    /** True once the loaded file's highlights are final: the sidecar has loaded and, for a PDF,
     *  the open document's highlight report has been taken in (merged with any migrate). False
     *  again from the next load. Optional so a story's stand-in store can leave it out. */
    highlightsSettled?: Accessor<boolean>
}

/** One node of a PDF's embedded outline; `page` is 0-based, null when the destination can't
 *  resolve. */
export type OutlineNode = {
    title: string
    page: number | null
    children: OutlineNode[]
}

export type PdfPagesController = {
    /** Scroll so page `index` sits at the top of the viewport; `yFraction` (0..1) offsets into
     *  the page. */
    scrollToPage: (index: number, yFraction?: number) => void
    /** Run `apply` (which changes the zoom) and keep whatever sat under client point (`x`, `y`)
     *  under it — the pinch / ctrl+wheel anchor. Without a point (a button glide) the viewport's
     *  centre is kept instead, or the top for a reader already at the very top. */
    zoomAt: (apply: () => void, x?: number, y?: number) => void
}

/** The ONE owner of a binary's companion note (`<file>.md`) while its preview is open: the tags
 *  frontmatter strip and the scratch-note blocks both edit through it, so there is one reader, one
 *  debounced writer and one conflict path for that file. */
export type CompanionStore = {
    loadState: Accessor<AnnotationLoadState>
    /** The raw frontmatter block, fences included; EMPTY_FRONTMATTER when the file has none. */
    frontmatter: Accessor<string>
    setFrontmatter: (text: string) => void
    /** Every block, including blank ones created in this session and not yet typed into. */
    blocks: Accessor<ScratchBlock[]>
    /** Bumps whenever `blocks` is REPLACED from disk (load, path switch, conflict reload) — a view
     *  keys its editors on it so seed-only fields pick up the new text. Local edits do not bump it. */
    revision: Accessor<number>
    /** Adds a block with a fresh id and returns that id. */
    addBlock: (b: Omit<ScratchBlock, 'id'>) => string
    updateBlock: (id: string, patch: Partial<Omit<ScratchBlock, 'id'>>) => void
    removeBlock: (id: string) => void
    /** Write any pending edit now. */
    flush: () => Promise<void>
}

/** Where a reader is in a PDF, independent of pane width and zoom: the page at the TOP of the
 *  viewport (0-based), how far into that page the viewport's top edge sits as a fraction of the
 *  page's rendered height (may exceed 1 while the top edge is in the gap below the page), and the
 *  horizontal scroll as a fraction of the scrollable width (0 when nothing overflows). */
export type PdfPosition = {
    index: number
    yFraction: number
    xFraction: number
}
