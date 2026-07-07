import { test, expect, describe } from "bun:test";
import { pointInDropRect, imageMimeFromPath, type DropRect } from "./nativeDrop";

// The native OS-file drop is a WINDOW-level event that every surface (chat / editor / terminal)
// receives; each must decide whether the drop at (x,y) belongs to IT. pointInDropRect IS that
// routing decision — verified here without a DOM so the "which pane claims the drop" logic is
// pinned. imageMimeFromPath is the chat composer's path→MIME classifier for the same native path.

const rect = (left: number, top: number, width: number, height: number): DropRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("pointInDropRect (which pane claims a native drop)", () => {
  test("inside → true", () => {
    expect(pointInDropRect(rect(100, 100, 200, 200), 150, 150)).toBe(true);
  });

  test("on the edges is inclusive", () => {
    const r = rect(100, 100, 200, 200); // right=300, bottom=300
    expect(pointInDropRect(r, 100, 100)).toBe(true);
    expect(pointInDropRect(r, 300, 300)).toBe(true);
  });

  test("outside on any side → false", () => {
    const r = rect(100, 100, 200, 200);
    expect(pointInDropRect(r, 99, 150)).toBe(false); // left of
    expect(pointInDropRect(r, 301, 150)).toBe(false); // right of
    expect(pointInDropRect(r, 150, 99)).toBe(false); // above
    expect(pointInDropRect(r, 150, 301)).toBe(false); // below
  });

  test("a 0×0 rect (a hidden display:none pane) is NEVER inside — even at the origin", () => {
    // A backgrounded pane collapses to a 0×0 rect at (0,0); a drop with no position is forwarded at
    // (0,0). Without the guard EVERY hidden pane would claim it — so this must be false.
    expect(pointInDropRect(rect(0, 0, 0, 0), 0, 0)).toBe(false);
  });

  test("routing: three non-overlapping panes → exactly the one under the cursor claims the drop", () => {
    const chat = rect(0, 0, 400, 800);
    const editor = rect(400, 0, 400, 400);
    const terminal = rect(400, 400, 400, 400);
    const x = 500,
      y = 200; // over the editor
    expect(pointInDropRect(chat, x, y)).toBe(false);
    expect(pointInDropRect(editor, x, y)).toBe(true);
    expect(pointInDropRect(terminal, x, y)).toBe(false);
  });
});

describe("imageMimeFromPath (chat composer path→MIME for native drops)", () => {
  test("maps the accepted image extensions", () => {
    expect(imageMimeFromPath("/Users/me/a.png")).toBe("image/png");
    expect(imageMimeFromPath("/Users/me/a.jpg")).toBe("image/jpeg");
    expect(imageMimeFromPath("/Users/me/a.jpeg")).toBe("image/jpeg");
    expect(imageMimeFromPath("/Users/me/a.gif")).toBe("image/gif");
    expect(imageMimeFromPath("/Users/me/a.webp")).toBe("image/webp");
  });

  test("is case-insensitive and handles Windows separators", () => {
    expect(imageMimeFromPath("/Users/me/SHOT.PNG")).toBe("image/png");
    expect(imageMimeFromPath("C:\\Users\\me\\Pic.JPEG")).toBe("image/jpeg");
  });

  test("rejects non-image / unsupported / extension-less paths", () => {
    expect(imageMimeFromPath("/Users/me/doc.pdf")).toBeNull(); // pdf isn't a valid image block
    expect(imageMimeFromPath("/Users/me/icon.svg")).toBeNull(); // svg isn't a valid image block
    expect(imageMimeFromPath("/Users/me/notes.md")).toBeNull();
    expect(imageMimeFromPath("/Users/me/Makefile")).toBeNull(); // no extension
    expect(imageMimeFromPath("")).toBeNull();
  });
});
