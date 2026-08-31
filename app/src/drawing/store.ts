import { createSignal } from 'solid-js'
import type {
    DrawingDoc,
    ImageEl,
    Stroke,
} from '../../../core/src/drawing/model'

export function createDrawingStore(
    initial: DrawingDoc,
    requestSave: (doc: DrawingDoc) => void,
) {
    const [doc, setDoc] = createSignal<DrawingDoc>(initial)
    const undoStack: DrawingDoc[] = []
    const redoStack: DrawingDoc[] = []

    function mutate(next: DrawingDoc) {
        undoStack.push(doc())
        redoStack.length = 0
        setDoc(next)
        requestSave(next)
    }
    const clone = (d: DrawingDoc): DrawingDoc => structuredClone(d)

    return {
        doc,
        commitStroke(pageIndex: number, s: Stroke) {
            const next = clone(doc())
            next.pages[pageIndex].strokes.push(s)
            mutate(next)
        },
        eraseStroke(pageIndex: number, strokeIndex: number) {
            const next = clone(doc())
            next.pages[pageIndex].strokes.splice(strokeIndex, 1)
            mutate(next)
        },
        addImage(pageIndex: number, img: ImageEl) {
            const next = clone(doc())
            const pg = next.pages[pageIndex]
            ;(pg.images ??= []).push(img)
            mutate(next)
        },
        removeImage(pageIndex: number, idx: number) {
            const next = clone(doc())
            const imgs = next.pages[pageIndex].images
            if (!imgs || idx < 0 || idx >= imgs.length) return
            imgs.splice(idx, 1)
            mutate(next)
        },
        setBackground(bg: DrawingDoc['paper']['bg']) {
            const next = clone(doc())
            next.paper.bg = bg
            mutate(next)
        },
        addPage() {
            const next = clone(doc())
            next.pages.push({ strokes: [] })
            mutate(next)
        },
        /** Rewrite a page's strokes WITHOUT touching undo/redo. This is bookkeeping, not a
         *  user edit: InkOverlay calls it on every document change to remap each stroke's
         *  line anchor (editor/InkOverlay.tsx), and a Ctrl+Z whose only effect was to undo
         *  the consequence of typing would be nonsense. The undo/redo stacks are rewritten
         *  by the SAME function, so undoing back past a remap cannot resurrect a document
         *  whose anchors still point at pre-edit positions.
         *
         *  Returns whether anything changed. `fn` returning its argument BY REFERENCE marks a
         *  stroke untouched, so a document change that moves no anchor costs neither a new
         *  document, nor a repaint, nor a save. */
        mapStrokes(pageIndex: number, fn: (s: Stroke) => Stroke): boolean {
            const apply = (d: DrawingDoc): DrawingDoc => {
                const pg = d.pages[pageIndex]
                if (!pg) return d
                const next = pg.strokes.map(fn)
                if (next.every((s, i) => s === pg.strokes[i])) return d
                const pages = d.pages.slice()
                pages[pageIndex] = { ...pg, strokes: next }
                return { ...d, pages }
            }
            for (const stack of [undoStack, redoStack]) {
                for (let i = 0; i < stack.length; i++)
                    stack[i] = apply(stack[i])
            }
            const cur = doc()
            const next = apply(cur)
            if (next === cur) return false
            setDoc(next)
            requestSave(next)
            return true
        },
        undo() {
            const prev = undoStack.pop()
            if (prev) {
                redoStack.push(doc())
                setDoc(prev)
                requestSave(prev)
            }
        },
        redo() {
            const next = redoStack.pop()
            if (next) {
                undoStack.push(doc())
                setDoc(next)
                requestSave(next)
            }
        },
    }
}
