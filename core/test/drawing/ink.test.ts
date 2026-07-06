import { describe, expect, test } from "bun:test";
import { emptyInkDoc, serializeInkDoc, parseInkDoc, inkPathFor, isInkSidecarPath } from "../../src/drawing/ink";
import { serializeDoc, emptyDoc } from "../../src/drawing/model";
import type { Stroke } from "../../src/drawing/model";

const stroke = (pts: number[]): Stroke => ({ t: "pen", c: "#000", w: 2, pts });

describe("ink doc", () => {
  test("round-trips strokes through serialize/parse", () => {
    const doc = emptyInkDoc();
    doc.strokes.push(stroke([1, 2, 128, 10, 20, 200]));
    const again = parseInkDoc(serializeInkDoc(doc));
    expect(again.kind).toBe("ink");
    expect(again.strokes).toHaveLength(1);
    expect(again.strokes[0].pts).toEqual([1, 2, 128, 10, 20, 200]);
  });

  test("serialization rounds geometry and clamps the pressure byte", () => {
    const doc = emptyInkDoc();
    doc.strokes.push(stroke([1.4, 2.6, 300.2, -3.5, 9.49, -12]));
    const again = parseInkDoc(serializeInkDoc(doc));
    // x/y rounded; every 3rd value (pressure byte) clamped to 0-255.
    expect(again.strokes[0].pts).toEqual([1, 3, 255, -3, 9, 0]);
  });

  test("parse rejects non-ink JSON (a .draw doc, arbitrary JSON, junk)", () => {
    expect(() => parseInkDoc(serializeDoc(emptyDoc()))).toThrow(); // kind:"drawing"
    expect(() => parseInkDoc("{}")).toThrow();
    expect(() => parseInkDoc('{"kind":"ink"}')).toThrow(); // strokes missing
    expect(() => parseInkDoc("not json")).toThrow();
  });

  test("inkPathFor mirrors the vault structure under .ink/", () => {
    expect(inkPathFor("Note.md")).toBe(".ink/Note.md.ink");
    expect(inkPathFor("thoughts/Deep/Idea.md")).toBe(".ink/thoughts/Deep/Idea.md.ink");
  });

  test("isInkSidecarPath matches the store root and its contents only", () => {
    expect(isInkSidecarPath(".ink")).toBe(true);
    expect(isInkSidecarPath(".ink/a/b.md.ink")).toBe(true);
    expect(isInkSidecarPath(".inkling.md")).toBe(false);
    expect(isInkSidecarPath("notes/.ink/x")).toBe(false);
    expect(isInkSidecarPath("a.md")).toBe(false);
  });
});
