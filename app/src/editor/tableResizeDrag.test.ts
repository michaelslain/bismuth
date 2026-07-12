// Pure lifecycle tests for the table column-resize drag controller (editor/tableResizeDrag.ts).
// The DOM wiring lives in tableWidget.ts (and a "releases on window blur" DOM test sits in
// tableWidget.test.ts); THIS file pins the two guarantees that make "resize always releases" hold:
// the width clamp, and — critically — that `end()` is idempotent so wiring it to several end events
// (pointerup / pointercancel / mouseup / blur) runs the cleanup exactly once.
import { test, expect, describe } from "bun:test";
import { computeResizeWidth, createResizeDrag, autoScrollDelta, frozenColumnsWidth } from "./tableResizeDrag";

describe("computeResizeWidth", () => {
  test("adds the delta to the start width", () => {
    expect(computeResizeWidth(120, 30, 40)).toBe(150);
    expect(computeResizeWidth(120, -30, 40)).toBe(90);
  });
  test("never goes below min", () => {
    expect(computeResizeWidth(60, -100, 40)).toBe(40); // would be -40 → clamped
    expect(computeResizeWidth(40, -5, 40)).toBe(40);
  });
  test("min is inclusive", () => {
    expect(computeResizeWidth(40, 0, 40)).toBe(40);
  });
});

describe("createResizeDrag", () => {
  test("move applies the clamped width for the pointer delta", () => {
    const widths: number[] = [];
    const drag = createResizeDrag({ originX: 100, startWidth: 40, min: 40, onWidth: (w) => widths.push(w), onEnd: () => {} });
    drag.move(160); // dx +60 → 100
    drag.move(120); // dx +20 → 60
    drag.move(80); //  dx -20 → clamped to 40
    expect(widths).toEqual([100, 60, 40]);
  });

  test("end() runs the cleanup EXACTLY once no matter how many end events fire", () => {
    let ends = 0;
    const drag = createResizeDrag({ originX: 0, startWidth: 40, min: 40, onWidth: () => {}, onEnd: () => { ends++; } });
    expect(drag.active).toBe(true);
    drag.end(); // e.g. pointerup
    drag.end(); // e.g. the trailing mouseup
    drag.end(); // e.g. a window blur
    expect(ends).toBe(1); // the stuck-cursor cleanup can't double-run OR be skipped
    expect(drag.active).toBe(false);
  });

  test("move after end is inert (a late pointermove can't resurrect a released drag)", () => {
    const widths: number[] = [];
    const drag = createResizeDrag({ originX: 0, startWidth: 0, min: 0, onWidth: (w) => widths.push(w), onEnd: () => {} });
    drag.move(50); // dx +50 → 50
    drag.end();
    drag.move(999); // ignored — already ended
    expect(widths).toEqual([50]);
  });
});

// ∞-mode auto-scroll nudge (#92): the drag follow-scrolls the horizontal scroller when the pointer
// nears an edge. Scroller spans [100, 700] with a 28px trigger zone in these cases.
describe("autoScrollDelta", () => {
  test("no nudge while the pointer is between the edge zones", () => {
    expect(autoScrollDelta(400, 100, 700, 28)).toBe(0);
    expect(autoScrollDelta(128, 100, 700, 28)).toBe(0); // exactly on the left zone boundary
    expect(autoScrollDelta(672, 100, 700, 28)).toBe(0); // exactly on the right zone boundary
  });
  test("past the right zone → positive nudge equal to the overshoot", () => {
    expect(autoScrollDelta(680, 100, 700, 28)).toBe(8);
    expect(autoScrollDelta(750, 100, 700, 28)).toBe(78); // pointer outside the window entirely
  });
  test("past the left zone → negative nudge equal to the overshoot", () => {
    expect(autoScrollDelta(120, 100, 700, 28)).toBe(-8);
    expect(autoScrollDelta(50, 100, 700, 28)).toBe(-78);
  });
});

// ∞-mode definite table width (#92): the widget sums the frozen per-column widths into an inline
// pixel width; a set with ANY unfrozen column yields null so the caller leaves the table alone.
describe("frozenColumnsWidth", () => {
  test("sums a fully frozen set", () => {
    expect(frozenColumnsWidth([120, 80, 200])).toBe(400);
    expect(frozenColumnsWidth([0, 100, 0])).toBe(100); // 0 is a real (headless-frozen) width
  });
  test("null when any column is unfrozen (NaN from an empty style)", () => {
    expect(frozenColumnsWidth([120, NaN, 200])).toBeNull();
  });
  test("empty set sums to 0 (degenerate, no columns)", () => {
    expect(frozenColumnsWidth([])).toBe(0);
  });
});
