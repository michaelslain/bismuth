import { test, expect } from "bun:test";
import { renderPage, type Ctx2D } from "../../src/drawing/render2d";
import { emptyDoc, PAGE_W, PAGE_H } from "../../src/drawing/model";
import { themeColors } from "../../src/drawing/theme";

function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "calls") return calls;
      return (...args: unknown[]) => { calls.push(`${prop}(${args.join(",")})`); };
    },
    set(_t, prop: string, value: unknown) { calls.push(`${String(prop)}=${String(value)}`); return true; },
  });
  return ctx as Ctx2D & { calls: string[] };
}

test("renderPage fills the paper background then draws each stroke", () => {
  const doc = emptyDoc();
  doc.paper.bg = "grid";
  doc.pages[0].strokes.push({ t: "pen", c: "fg", w: 4, pts: [10, 10, 255, 40, 40, 255] });
  const ctx = recorder();
  renderPage(ctx, doc.pages[0], doc.paper, themeColors("dark"), PAGE_W, PAGE_H);
  const joined = (ctx as any).calls.join("|");
  expect(joined).toContain("fillRect(0,0,816,1056)");
  expect(joined).toContain("beginPath");
  expect(joined).toContain("fill(");
});

test("highlighter strokes use multiply compositing", () => {
  const doc = emptyDoc();
  doc.pages[0].strokes.push({ t: "hl", c: "#e23b3b", w: 8, pts: [0, 0, 255, 50, 0, 255] });
  const ctx = recorder();
  renderPage(ctx, doc.pages[0], doc.paper, themeColors("dark"), PAGE_W, PAGE_H);
  expect((ctx as any).calls.join("|")).toContain("globalCompositeOperation=multiply");
});
