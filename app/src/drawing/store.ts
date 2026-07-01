import { createSignal } from "solid-js";
import type { DrawingDoc, ImageEl, Stroke } from "../../../core/src/drawing/model";

export function createDrawingStore(initial: DrawingDoc, requestSave: (doc: DrawingDoc) => void) {
  const [doc, setDoc] = createSignal<DrawingDoc>(initial);
  const undoStack: DrawingDoc[] = [];
  const redoStack: DrawingDoc[] = [];

  function mutate(next: DrawingDoc) {
    undoStack.push(doc());
    redoStack.length = 0;
    setDoc(next);
    requestSave(next);
  }
  const clone = (d: DrawingDoc): DrawingDoc => structuredClone(d);

  return {
    doc,
    commitStroke(pageIndex: number, s: Stroke) {
      const next = clone(doc());
      next.pages[pageIndex].strokes.push(s);
      mutate(next);
    },
    eraseStroke(pageIndex: number, strokeIndex: number) {
      const next = clone(doc());
      next.pages[pageIndex].strokes.splice(strokeIndex, 1);
      mutate(next);
    },
    addImage(pageIndex: number, img: ImageEl) {
      const next = clone(doc());
      const pg = next.pages[pageIndex];
      (pg.images ??= []).push(img);
      mutate(next);
    },
    removeImage(pageIndex: number, idx: number) {
      const next = clone(doc());
      const imgs = next.pages[pageIndex].images;
      if (!imgs || idx < 0 || idx >= imgs.length) return;
      imgs.splice(idx, 1);
      mutate(next);
    },
    setBackground(bg: DrawingDoc["paper"]["bg"]) {
      const next = clone(doc());
      next.paper.bg = bg;
      mutate(next);
    },
    addPage() {
      const next = clone(doc());
      next.pages.push({ strokes: [] });
      mutate(next);
    },
    undo() {
      const prev = undoStack.pop();
      if (prev) {
        redoStack.push(doc());
        setDoc(prev);
        requestSave(prev);
      }
    },
    redo() {
      const next = redoStack.pop();
      if (next) {
        undoStack.push(doc());
        setDoc(next);
        requestSave(next);
      }
    },
  };
}
