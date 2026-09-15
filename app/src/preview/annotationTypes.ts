// app/src/preview/annotationTypes.ts
// Shared types for in-place annotations on an image/PDF preview: the one store that owns a
// binary's `.draw` sidecar, and the PDF navigation seams (outline + scroll controller). Types
// only — `createAnnotationStore.ts` implements the store, `PdfPages.tsx` the controller.
import type { Accessor } from 'solid-js'
import type { DrawingDoc } from '../../../core/src/drawing/model'

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
