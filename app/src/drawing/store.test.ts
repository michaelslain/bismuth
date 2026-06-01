import { test, expect } from "bun:test";
import { createDrawingStore } from "./store";
import { emptyDoc } from "../../../core/src/drawing/model";

const stroke = () => ({ t: "pen" as const, c: "fg", w: 4, pts: [0, 0, 255, 5, 5, 255] });

test("commitStroke appends to the active page; undo/redo move through history", () => {
  const s = createDrawingStore(emptyDoc(), () => {});
  s.commitStroke(0, stroke());
  expect(s.doc().pages[0].strokes.length).toBe(1);
  s.undo();
  expect(s.doc().pages[0].strokes.length).toBe(0);
  s.redo();
  expect(s.doc().pages[0].strokes.length).toBe(1);
});

test("addPage appends an empty page", () => {
  const s = createDrawingStore(emptyDoc(), () => {});
  s.addPage();
  expect(s.doc().pages.length).toBe(2);
});

test("a mutation requests a save", () => {
  let saves = 0;
  const s = createDrawingStore(emptyDoc(), () => { saves++; });
  s.commitStroke(0, stroke());
  expect(saves).toBe(1);
});
