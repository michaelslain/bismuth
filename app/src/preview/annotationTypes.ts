// app/src/preview/annotationTypes.ts
// Shared types for in-place annotations on an image/PDF preview: the one store that owns a
// binary's `.draw` sidecar, and the PDF navigation seams (outline + scroll controller). Types
// only — `createAnnotationStore.ts` implements the store, `PdfPages.tsx` the controller.
import type { Accessor } from 'solid-js'
import type { DrawingDoc } from '../../../core/src/drawing/model'
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
